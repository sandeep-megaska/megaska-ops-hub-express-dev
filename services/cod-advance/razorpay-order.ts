/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma as defaultPrisma } from "../db/prisma";
import { resolveExpressCheckoutCodPolicy } from "./resolver";
import { auditCodAdvance } from "./core";

type Db = typeof defaultPrisma;
type JsonRecord = Record<string, unknown>;

export const COD_ADVANCE_REUSE_WINDOW_MS = Number(process.env.COD_ADVANCE_RAZORPAY_ORDER_REUSE_WINDOW_MS || 15 * 60_000);

export class CodAdvanceRazorpayOrderError extends Error {
  status: number;
  code: string;
  constructor(code: string, status = 409, message = code) {
    super(message);
    this.name = "CodAdvanceRazorpayOrderError";
    this.code = code;
    this.status = status;
  }
}

export type CodAdvanceRazorpayOrderDeps = {
  db?: Db;
  now?: () => Date;
  resolvePolicy?: typeof resolveExpressCheckoutCodPolicy;
  audit?: typeof auditCodAdvance;
  createGatewayOrder?: (input: { amountPaise: number; currency: string; receipt: string; notes: JsonRecord }) => Promise<{ id: string; amount?: number; currency?: string }>;
  getRazorpayCredentials?: () => Promise<{ keyId: string; keySecret: string }> | { keyId: string; keySecret: string };
  reuseWindowMs?: number;
};

function credentials() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!keyId || !keySecret) throw new CodAdvanceRazorpayOrderError("RAZORPAY_CONFIGURATION_MISSING", 503);
  return { keyId, keySecret };
}

async function gatewayOrder(input: { amountPaise: number; currency: string; receipt: string; notes: JsonRecord }) {
  const { keyId, keySecret } = credentials();
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.receipt, notes: input.notes }),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok || !payload?.id) throw new CodAdvanceRazorpayOrderError("RAZORPAY_ORDER_CREATION_FAILED", 503);
  return payload as { id: string; amount?: number; currency?: string };
}

function safePayload(order: { id: string; amount?: number; currency?: string }) {
  return { id: order.id, amount: order.amount ?? null, currency: order.currency ?? null };
}

function receiptFor(checkoutIntentId: string, paymentId: string) {
  return `LD-COD-${checkoutIntentId.slice(0, 8)}-${paymentId.slice(0, 12)}`.slice(0, 40);
}

function isSafeReusable(payment: any, cod: any, now: Date, reuseWindowMs: number) {
  return payment && payment.method === "COD" && payment.purpose === "COD_ADVANCE" && payment.status === "PENDING" && payment.amountPaise === cod.advanceAmountPaise && payment.currency === cod.currency && payment.razorpayOrderId && !payment.razorpayPaymentId && now.getTime() - new Date(payment.createdAt).getTime() <= reuseWindowMs;
}

async function validate(input: { shopId: string; checkoutIntentId: string; customerProfileId: string }, db: any, now: Date) {
  const intent = await db.expressCheckoutIntent.findFirst({ where: { id: input.checkoutIntentId }, include: { orderLink: true } });
  if (!intent) throw new CodAdvanceRazorpayOrderError("CHECKOUT_NOT_ELIGIBLE", 404);
  if (intent.shopId !== input.shopId) throw new CodAdvanceRazorpayOrderError("CHECKOUT_NOT_ELIGIBLE", 404);
  if (intent.customerProfileId !== input.customerProfileId) throw new CodAdvanceRazorpayOrderError("CHECKOUT_NOT_ELIGIBLE", 404);
  if (intent.expiresAt && intent.expiresAt <= now) throw new CodAdvanceRazorpayOrderError("CHECKOUT_NOT_ELIGIBLE", 409);
  if (intent.selectedPaymentMethod !== "COD") throw new CodAdvanceRazorpayOrderError("CHECKOUT_NOT_ELIGIBLE", 409);
  if (!["CREATED", "CUSTOMER_AUTHENTICATED", "CART_SNAPSHOT_LOCKED", "ADDRESS_CAPTURED", "DISCOUNT_APPLIED", "PAYMENT_METHOD_SELECTED", "INITIATED", "SESSION_VERIFIED", "ADDRESS_COMPLETED", "DELIVERY_VALIDATED", "COUPON_APPLIED", "PAYMENT_SELECTED", "PAYMENT_PENDING"].includes(intent.status)) throw new CodAdvanceRazorpayOrderError("CHECKOUT_NOT_ELIGIBLE", 409);

  const cod = await db.codAdvanceIntent.findFirst({ where: { shopId: input.shopId, expressCheckoutIntentId: intent.id, customerProfileId: input.customerProfileId, status: { in: ["CREATED", "PAYMENT_PENDING"] } }, orderBy: { createdAt: "desc" } });
  if (!cod) throw new CodAdvanceRazorpayOrderError("COD_ADVANCE_INTENT_NOT_FOUND", 404);
  if (cod.expiresAt && cod.expiresAt <= now) throw new CodAdvanceRazorpayOrderError("COD_ADVANCE_INTENT_EXPIRED", 409);
  if (cod.paidAt || cod.verifiedAt || cod.razorpayPaymentId) throw new CodAdvanceRazorpayOrderError("COD_ADVANCE_ALREADY_PAID", 409);
  if (cod.consumedAt || cod.shopifyDraftOrderId || cod.shopifyOrderId || cod.shopifyOrderName || intent.orderLink?.draftOrderId || intent.orderLink?.shopifyOrderId) throw new CodAdvanceRazorpayOrderError("CHECKOUT_NOT_ELIGIBLE", 409);
  if (!(cod.advanceAmountPaise > 0)) throw new CodAdvanceRazorpayOrderError("COD_ADVANCE_NOT_REQUIRED", 409);
  if (cod.codBalanceAmountPaise < 0) throw new CodAdvanceRazorpayOrderError("CHECKOUT_NOT_ELIGIBLE", 409);
  return { intent, cod };
}

export async function createCodAdvanceRazorpayOrder(input: { shopId: string; shopDomain: string; checkoutIntentId: string; customerProfileId: string }, deps: CodAdvanceRazorpayOrderDeps = {}) {
  const db = (deps.db || defaultPrisma) as any;
  const now = (deps.now || (() => new Date()))();
  const audit = deps.audit || auditCodAdvance;
  const { intent, cod } = await validate(input, db, now);
  const resolvePolicy = deps.resolvePolicy || resolveExpressCheckoutCodPolicy;
  const quote = await resolvePolicy(input, db, { audit });
  if (!quote.requiresAdvance || quote.codAdvanceIntentId !== cod.id || quote.advanceAmountPaise !== cod.advanceAmountPaise || quote.codBalanceAmountPaise !== cod.codBalanceAmountPaise || quote.currency !== cod.currency) throw new CodAdvanceRazorpayOrderError("COD_ADVANCE_QUOTE_STALE", 409);
  const fresh = await db.codAdvanceIntent.findFirst({ where: { id: cod.id, shopId: input.shopId } });
  if (fresh?.pricingFingerprint !== cod.pricingFingerprint || fresh?.settingsVersion !== cod.settingsVersion) throw new CodAdvanceRazorpayOrderError("COD_ADVANCE_QUOTE_STALE", 409);
  const { keyId } = await (deps.getRazorpayCredentials || credentials)();
  const reuseWindowMs = deps.reuseWindowMs ?? COD_ADVANCE_REUSE_WINDOW_MS;

  const pending = await db.expressCheckoutPayment.findFirst({ where: { shopId: input.shopId, intentId: intent.id, method: "COD", purpose: "COD_ADVANCE", status: "PENDING" }, orderBy: { createdAt: "desc" } });
  if (isSafeReusable(pending, cod, now, reuseWindowMs)) {
    await audit("cod_advance.razorpay_order.reused", "ExpressCheckoutPayment", pending.id, { shopId: input.shopId, checkoutIntentId: intent.id, codAdvanceIntentId: cod.id });
    return { razorpayOrder: { id: pending.razorpayOrderId, amount: pending.amountPaise, currency: pending.currency, keyId }, cod: { codAdvanceIntentId: cod.id, advanceAmountPaise: cod.advanceAmountPaise, codBalanceAmountPaise: cod.codBalanceAmountPaise, orderTotalPaise: cod.orderAmountPaise, storeCreditAppliedPaise: cod.storeCreditAppliedPaise || 0 }, paymentId: pending.id, reused: true };
  }

  const payment = await db.expressCheckoutPayment.create({ data: { shopId: input.shopId, intentId: intent.id, method: "COD", purpose: "COD_ADVANCE", status: "PENDING", amountPaise: cod.advanceAmountPaise, currency: cod.currency } });
  await audit("cod_advance.payment_attempt.created", "ExpressCheckoutPayment", payment.id, { shopId: input.shopId, checkoutIntentId: intent.id, codAdvanceIntentId: cod.id });
  let order: { id: string; amount?: number; currency?: string };
  try {
    order = await (deps.createGatewayOrder || gatewayOrder)({ amountPaise: cod.advanceAmountPaise, currency: cod.currency, receipt: receiptFor(intent.id, payment.id), notes: { purpose: "COD_ADVANCE", shopId: input.shopId, checkoutIntentId: intent.id, codAdvanceIntentId: cod.id, paymentRecordId: payment.id } });
  } catch (error) {
    await audit("cod_advance.razorpay_order.failed", "ExpressCheckoutPayment", payment.id, { shopId: input.shopId, checkoutIntentId: intent.id, codAdvanceIntentId: cod.id, code: error instanceof CodAdvanceRazorpayOrderError ? error.code : "RAZORPAY_ORDER_CREATION_FAILED" });
    throw error instanceof CodAdvanceRazorpayOrderError ? error : new CodAdvanceRazorpayOrderError("RAZORPAY_ORDER_CREATION_FAILED", 503);
  }
  try {
    await db.expressCheckoutPayment.update({ where: { id: payment.id }, data: { razorpayOrderId: order.id, providerAmountPaise: Number(order.amount ?? cod.advanceAmountPaise), providerCurrency: String(order.currency || cod.currency), rawGatewayPayload: safePayload(order) } });
    await db.codAdvanceIntent.updateMany({ where: { id: cod.id, shopId: input.shopId, status: { in: ["CREATED", "PAYMENT_PENDING"] }, paidAt: null, verifiedAt: null, consumedAt: null }, data: { status: "PAYMENT_PENDING" } });
  } catch (error) {
    await audit("cod_advance.reconciliation.required", "ExpressCheckoutPayment", payment.id, { shopId: input.shopId, checkoutIntentId: intent.id, codAdvanceIntentId: cod.id, razorpayOrderId: order.id });
    throw new CodAdvanceRazorpayOrderError("RAZORPAY_ORDER_CREATION_FAILED", 503, error instanceof Error ? error.message : "Persistence failed after Razorpay order creation");
  }
  await audit("cod_advance.razorpay_order.created", "ExpressCheckoutPayment", payment.id, { shopId: input.shopId, checkoutIntentId: intent.id, codAdvanceIntentId: cod.id, razorpayOrderId: order.id });
  return { razorpayOrder: { id: order.id, amount: cod.advanceAmountPaise, currency: cod.currency, keyId }, cod: { codAdvanceIntentId: cod.id, advanceAmountPaise: cod.advanceAmountPaise, codBalanceAmountPaise: cod.codBalanceAmountPaise, orderTotalPaise: cod.orderAmountPaise, storeCreditAppliedPaise: cod.storeCreditAppliedPaise || 0 }, paymentId: payment.id, reused: false };
}
