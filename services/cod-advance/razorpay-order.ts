/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolveExpressCheckoutCodPolicy, type CodPolicyDto } from "./resolver.ts";

export type CodAdvanceRazorpayOrderInput = { shopId: string; shopDomain: string; checkoutIntentId: string; customerProfileId: string };
export type CodAdvanceRazorpayOrderOutput = {
  razorpayOrder: { id: string; amount: number; currency: string; keyId: string };
  cod: { codAdvanceIntentId: string; advanceAmountPaise: number; codBalanceAmountPaise: number; orderTotalPaise: number; storeCreditAppliedPaise: number };
  paymentId: string;
  reused: boolean;
};

type Db = any;
type Deps = { db?: Db; now?: () => Date; fetch?: typeof fetch; audit?: (eventType: string, entityType: string, entityId: string | null, payload?: unknown) => Promise<unknown>; resolvePolicy?: typeof resolveExpressCheckoutCodPolicy; keyId?: string; keySecret?: string };

const REUSE_WINDOW_MS = 15 * 60_000;
const IN_PROGRESS_WINDOW_MS = 90_000;
const PRE_PAYMENT = new Set(["CREATED", "CUSTOMER_AUTHENTICATED", "CART_SNAPSHOT_LOCKED", "ADDRESS_CAPTURED", "DISCOUNT_APPLIED", "PAYMENT_METHOD_SELECTED", "INITIATED", "SESSION_VERIFIED", "ADDRESS_COMPLETED", "DELIVERY_VALIDATED", "COUPON_APPLIED", "PAYMENT_SELECTED", "PAYMENT_PENDING"]);

export class CodAdvanceRazorpayOrderError extends Error {
  status: 404 | 409 | 503;
  code: string;
  constructor(status: 404 | 409 | 503, code: string, message: string) {
    super(message);
    this.name = "CodAdvanceRazorpayOrderError";
    this.status = status;
    this.code = code;
  }
}

function key(deps: Deps) { const keyId = String(deps.keyId ?? process.env.RAZORPAY_KEY_ID ?? "").trim(); const keySecret = String(deps.keySecret ?? process.env.RAZORPAY_KEY_SECRET ?? "").trim(); if (!keyId || !keySecret) throw new CodAdvanceRazorpayOrderError(503, "RAZORPAY_NOT_CONFIGURED", "Razorpay is not configured"); return { keyId, keySecret }; }
function safe(value: unknown) { return JSON.parse(JSON.stringify(value ?? null)); }
function redactedOrderPayload(order: any) { return safe({ id: order?.id || null, amount: order?.amount ?? null, currency: order?.currency || null, status: order?.status || null, receipt: order?.receipt || null }); }
function receipt(input: CodAdvanceRazorpayOrderInput, codAdvanceIntentId: string) { return `codadv_${input.checkoutIntentId}_${codAdvanceIntentId}`.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40); }
function audit(deps: Deps, eventType: string, entityType: string, entityId: string | null, payload?: unknown) { return (deps.audit || (async () => undefined))(eventType, entityType, entityId, payload).catch(() => undefined); }
function assertEqual(actual: unknown, expected: unknown, code: string) { if (actual !== expected) throw new CodAdvanceRazorpayOrderError(code === "NOT_FOUND" ? 404 : 409, code, "COD advance is no longer valid"); }

async function loadAndValidate(db: any, input: CodAdvanceRazorpayOrderInput, policy: CodPolicyDto, now: Date) {
  const shop = await db.shop.findFirst({ where: { id: input.shopId, shopDomain: input.shopDomain, isActive: true, uninstalledAt: null }, select: { id: true } });
  if (!shop) throw new CodAdvanceRazorpayOrderError(404, "SHOP_NOT_FOUND", "Shop not found");
  const checkout = await db.expressCheckoutIntent.findFirst({ where: { id: input.checkoutIntentId, shopId: input.shopId, customerProfileId: input.customerProfileId }, include: { orderLink: true } });
  if (!checkout) throw new CodAdvanceRazorpayOrderError(404, "CHECKOUT_NOT_FOUND", "Checkout not found");
  if (checkout.selectedPaymentMethod !== "COD") throw new CodAdvanceRazorpayOrderError(409, "COD_REQUIRED", "COD is required");
  if (checkout.expiresAt && checkout.expiresAt <= now) throw new CodAdvanceRazorpayOrderError(409, "CHECKOUT_EXPIRED", "Checkout expired");
  if (!PRE_PAYMENT.has(checkout.status)) throw new CodAdvanceRazorpayOrderError(409, "INVALID_CHECKOUT_STATE", "Invalid checkout state");
  if (checkout.orderLink?.shopifyOrderId || checkout.orderLink?.shopifyOrderName) throw new CodAdvanceRazorpayOrderError(409, "SHOPIFY_ORDER_EXISTS", "Checkout already has an order");
  if (!policy.requiresAdvance || !policy.codAdvanceIntentId) throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_NOT_REQUIRED", "COD advance is not required");
  const cod = await db.codAdvanceIntent.findFirst({ where: { id: policy.codAdvanceIntentId, shopId: input.shopId, customerProfileId: input.customerProfileId, expressCheckoutIntentId: input.checkoutIntentId } });
  if (!cod) throw new CodAdvanceRazorpayOrderError(404, "COD_ADVANCE_INTENT_NOT_FOUND", "COD advance intent not found");
  if (!["CREATED", "PAYMENT_PENDING"].includes(cod.status) || cod.advanceAmountPaise <= 0 || cod.codBalanceAmountPaise < 0 || (cod.expiresAt && cod.expiresAt <= now) || cod.paidAt || cod.verifiedAt || cod.consumedAt || cod.razorpayPaymentId || cod.shopifyDraftOrderId || cod.shopifyOrderId || cod.shopifyOrderName) throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_INTENT_STALE", "COD advance intent is stale");
  assertEqual(policy.codAdvanceIntentId, cod.id, "POLICY_MISMATCH"); assertEqual(policy.advanceAmountPaise, cod.advanceAmountPaise, "POLICY_AMOUNT_MISMATCH"); assertEqual(policy.codBalanceAmountPaise, cod.codBalanceAmountPaise, "POLICY_COD_BALANCE_MISMATCH"); assertEqual(policy.orderTotalPaise, cod.orderAmountPaise, "POLICY_ORDER_TOTAL_MISMATCH"); assertEqual(policy.storeCreditAppliedPaise, cod.storeCreditAppliedPaise || 0, "POLICY_STORE_CREDIT_MISMATCH"); assertEqual(String(policy.currency).toUpperCase(), String(cod.currency).toUpperCase(), "POLICY_CURRENCY_MISMATCH");
  return { checkout, cod };
}

async function createProviderOrder(input: CodAdvanceRazorpayOrderInput, cod: any, paymentId: string, deps: Deps) {
  const { keyId, keySecret } = key(deps); const fetcher = deps.fetch || fetch;
  const response = await fetcher("https://api.razorpay.com/v1/orders", { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "Content-Type": "application/json" }, body: JSON.stringify({ amount: cod.advanceAmountPaise, currency: cod.currency, receipt: receipt(input, cod.id), notes: { purpose: "COD_ADVANCE", shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, codAdvanceIntentId: cod.id, paymentRecordId: paymentId } }) });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.id) throw new CodAdvanceRazorpayOrderError(503, "RAZORPAY_ORDER_CREATION_FAILED", "Razorpay order creation failed");
  return { order: payload, keyId };
}

export async function createCodAdvanceRazorpayOrder(input: CodAdvanceRazorpayOrderInput, deps: Deps = {}): Promise<CodAdvanceRazorpayOrderOutput> {
  const db: any = deps.db || (await import("../db/prisma.ts")).prisma; const now = deps.now?.() || new Date(); const resolvePolicy = deps.resolvePolicy || resolveExpressCheckoutCodPolicy;
  const policy = await resolvePolicy(input, db, { audit: deps.audit });
  const first = await loadAndValidate(db, input, policy, now);
  const fresh = await db.codAdvanceIntent.findFirst({ where: { id: first.cod.id, shopId: input.shopId }, select: { pricingFingerprint: true, settingsVersion: true, advanceAmountPaise: true, codBalanceAmountPaise: true } });
  if (!fresh || fresh.pricingFingerprint !== first.cod.pricingFingerprint || fresh.settingsVersion !== first.cod.settingsVersion || fresh.advanceAmountPaise !== first.cod.advanceAmountPaise || fresh.codBalanceAmountPaise !== first.cod.codBalanceAmountPaise) throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_CHANGED", "COD advance changed");
  const reserved = await db.$transaction(async (tx: any) => {
    if (typeof tx.$executeRaw === "function") await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.shopId}:${input.checkoutIntentId}:cod_advance_razorpay_order`}))`;
    await loadAndValidate(tx, input, policy, deps.now?.() || new Date());
    const minReuse = new Date(now.getTime() - REUSE_WINDOW_MS); const minProgress = new Date(now.getTime() - IN_PROGRESS_WINDOW_MS);
    const reusable = await tx.expressCheckoutPayment.findFirst({ where: { shopId: input.shopId, intentId: input.checkoutIntentId, method: "COD", purpose: "COD_ADVANCE", status: "PENDING", amountPaise: first.cod.advanceAmountPaise, currency: first.cod.currency, razorpayOrderId: { not: null }, razorpayPaymentId: null, createdAt: { gte: minReuse }, OR: [{ providerAmountPaise: null }, { providerAmountPaise: first.cod.advanceAmountPaise }], AND: [{ OR: [{ providerCurrency: null }, { providerCurrency: first.cod.currency }] }] }, orderBy: { createdAt: "desc" } });
    if (reusable) return { kind: "reused", payment: reusable };
    const inProgress = await tx.expressCheckoutPayment.findFirst({ where: { shopId: input.shopId, intentId: input.checkoutIntentId, method: "COD", purpose: "COD_ADVANCE", status: "PENDING", razorpayOrderId: null, createdAt: { gte: minProgress } }, orderBy: { createdAt: "desc" } });
    if (inProgress) return { kind: "in_progress", payment: inProgress };
    await tx.expressCheckoutPayment.updateMany({ where: { shopId: input.shopId, intentId: input.checkoutIntentId, method: "COD", purpose: "COD_ADVANCE", status: "PENDING", razorpayOrderId: null, createdAt: { lt: minProgress } }, data: { status: "FAILED", failureReason: "stale_cod_advance_order_reservation" } });
    const payment = await tx.expressCheckoutPayment.create({ data: { shopId: input.shopId, intentId: input.checkoutIntentId, method: "COD", purpose: "COD_ADVANCE", status: "PENDING", amountPaise: first.cod.advanceAmountPaise, currency: first.cod.currency } });
    return { kind: "new", payment };
  });
  const out = (payment: any, reused: boolean): CodAdvanceRazorpayOrderOutput => ({ razorpayOrder: { id: payment.razorpayOrderId, amount: first.cod.advanceAmountPaise, currency: first.cod.currency, keyId: key(deps).keyId }, cod: { codAdvanceIntentId: first.cod.id, advanceAmountPaise: first.cod.advanceAmountPaise, codBalanceAmountPaise: first.cod.codBalanceAmountPaise, orderTotalPaise: first.cod.orderAmountPaise, storeCreditAppliedPaise: first.cod.storeCreditAppliedPaise || 0 }, paymentId: payment.id, reused });
  if (reserved.kind === "reused") { await audit(deps, "cod_advance.razorpay_order.reused", "ExpressCheckoutPayment", reserved.payment.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId }); return out(reserved.payment, true); }
  if (reserved.kind === "in_progress") { await audit(deps, "cod_advance.payment_in_progress", "ExpressCheckoutPayment", reserved.payment.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId }); throw new CodAdvanceRazorpayOrderError(409, "PAYMENT_IN_PROGRESS", "Payment is already in progress"); }
  await audit(deps, "cod_advance.payment_attempt.reserved", "ExpressCheckoutPayment", reserved.payment.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, codAdvanceIntentId: first.cod.id });
  let provider;
  try { provider = await createProviderOrder(input, first.cod, reserved.payment.id, deps); }
  catch (e) { await db.$transaction((tx: any) => tx.expressCheckoutPayment.update({ where: { id: reserved.payment.id }, data: { status: "FAILED", failureReason: "razorpay_order_creation_failed" } })); await audit(deps, "cod_advance.razorpay_order.failed", "ExpressCheckoutPayment", reserved.payment.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId }); throw e instanceof CodAdvanceRazorpayOrderError ? e : new CodAdvanceRazorpayOrderError(503, "RAZORPAY_ORDER_CREATION_FAILED", "Razorpay order creation failed"); }
  const providerAmount = Number(provider.order.amount); const providerCurrency = String(provider.order.currency || "");
  if (!provider.order.id || providerAmount !== first.cod.advanceAmountPaise || providerCurrency.toUpperCase() !== String(first.cod.currency).toUpperCase()) { await db.$transaction((tx: any) => tx.expressCheckoutPayment.update({ where: { id: reserved.payment.id }, data: { status: "FAILED", providerAmountPaise: Number.isFinite(providerAmount) ? providerAmount : null, providerCurrency: providerCurrency || null, rawGatewayPayload: redactedOrderPayload(provider.order), failureReason: "razorpay_order_validation_failed" } })); await audit(deps, "cod_advance.razorpay_order.failed", "ExpressCheckoutPayment", reserved.payment.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId }); throw new CodAdvanceRazorpayOrderError(503, "RAZORPAY_ORDER_CREATION_FAILED", "Razorpay order creation failed"); }
  const persisted = await db.$transaction((tx: any) => tx.expressCheckoutPayment.update({ where: { id: reserved.payment.id }, data: { razorpayOrderId: provider.order.id, providerAmountPaise: providerAmount, providerCurrency, rawGatewayPayload: redactedOrderPayload(provider.order), failureReason: null } }));
  await audit(deps, "cod_advance.razorpay_order.created", "ExpressCheckoutPayment", persisted.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, codAdvanceIntentId: first.cod.id, razorpayOrderId: provider.order.id });
  const transition = await db.$transaction((tx: any) => tx.codAdvanceIntent.updateMany({ where: { id: first.cod.id, shopId: input.shopId, status: { in: ["CREATED", "PAYMENT_PENDING"] }, paidAt: null, verifiedAt: null, consumedAt: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null }, data: { status: "PAYMENT_PENDING" } }));
  if (transition.count !== 1) { await audit(deps, "cod_advance.reconciliation.required", "CodAdvanceIntent", first.cod.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, paymentId: persisted.id, razorpayOrderId: provider.order.id }); throw new CodAdvanceRazorpayOrderError(503, "COD_ADVANCE_RECONCILIATION_REQUIRED", "COD advance reconciliation required"); }
  return { razorpayOrder: { id: provider.order.id, amount: providerAmount, currency: providerCurrency, keyId: provider.keyId }, cod: { codAdvanceIntentId: first.cod.id, advanceAmountPaise: first.cod.advanceAmountPaise, codBalanceAmountPaise: first.cod.codBalanceAmountPaise, orderTotalPaise: first.cod.orderAmountPaise, storeCreditAppliedPaise: first.cod.storeCreditAppliedPaise || 0 }, paymentId: persisted.id, reused: false };
}
