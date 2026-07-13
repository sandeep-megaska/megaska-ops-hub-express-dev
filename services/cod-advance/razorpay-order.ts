/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "../db/prisma";
import { getShopByDomain, normalizeShopDomain, ShopResolutionError } from "../shopify/shop";
import { resolveExpressCheckoutCodPolicy } from "./resolver";

type JsonRecord = Record<string, unknown>;

type Db = typeof prisma;

export type CreateCodAdvanceRazorpayOrderInput = {
  shopId: string;
  shopDomain: string;
  checkoutIntentId: string;
  customerProfileId: string;
};

export type CreateCodAdvanceRazorpayOrderResult = {
  razorpayOrder: { id: string; amount: number; currency: string; keyId: string };
  cod: { codAdvanceIntentId: string; advanceAmountPaise: number; codBalanceAmountPaise: number; orderTotalPaise: number; storeCreditAppliedPaise: number };
  paymentId: string;
  reused: boolean;
};

export class CodAdvanceRazorpayOrderError extends Error {
  status: number;
  code: string;
  stage: string;

  constructor(status: number, code: string, message = "Could not start COD advance payment. Please try again.", stage = "COD_ADVANCE_RAZORPAY_ORDER_CREATE") {
    super(message);
    this.name = "CodAdvanceRazorpayOrderError";
    this.status = status;
    this.code = code;
    this.stage = stage;
  }
}

type Deps = {
  db?: Db;
  resolvePolicy?: typeof resolveExpressCheckoutCodPolicy;
  createGatewayOrder?: (input: { amountPaise: number; currency: string; receipt: string; notes: JsonRecord }) => Promise<JsonRecord>;
  getKeyId?: () => string;
  audit?: (eventType: string, entityType: string, entityId: string | null, payload?: unknown) => Promise<unknown>;
  resolveShop?: (shopDomain: string) => Promise<{ id: string; shopDomain?: string | null; isActive?: boolean; uninstalledAt?: Date | null } | null>;
};

type LocalValidation = {
  checkout: any;
  codIntent: any;
  policy: Awaited<ReturnType<typeof resolveExpressCheckoutCodPolicy>>;
};

function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function safeFailure(error: unknown) {
  if (error instanceof CodAdvanceRazorpayOrderError) return error.code;
  if (error && typeof error === "object" && "code" in error) return String((error as { code?: unknown }).code || "RAZORPAY_ORDER_CREATION_FAILED").slice(0, 200);
  return error instanceof Error ? String(error.message || error.name).slice(0, 200) : "RAZORPAY_ORDER_CREATION_FAILED";
}

function getRazorpayCredentialsKeyId() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!keyId || !keySecret) throw new CodAdvanceRazorpayOrderError(503, "RAZORPAY_NOT_CONFIGURED");
  return keyId;
}

async function defaultCreateGatewayOrder(input: { amountPaise: number; currency: string; receipt: string; notes: JsonRecord }) {
  const keyId = getRazorpayCredentialsKeyId();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.receipt, notes: input.notes }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new CodAdvanceRazorpayOrderError(502, "RAZORPAY_ORDER_CREATION_FAILED");
  return payload as JsonRecord;
}

async function resolveActiveShop(input: CreateCodAdvanceRazorpayOrderInput, deps: Deps) {
  const shop = await (deps.resolveShop ? deps.resolveShop(input.shopDomain) : getShopByDomain(normalizeShopDomain(input.shopDomain)));
  if (!shop) throw new ShopResolutionError(404, "Shop not found");
  if (shop.id !== input.shopId) throw new CodAdvanceRazorpayOrderError(404, "CHECKOUT_NOT_FOUND");
  if (shop.isActive === false || shop.uninstalledAt) throw new ShopResolutionError(403, "Shop is inactive");
  return shop;
}

async function validateLocal(input: CreateCodAdvanceRazorpayOrderInput, db: any, deps: Deps): Promise<LocalValidation> {
  const now = new Date();
  const checkout = await db.expressCheckoutIntent.findFirst({ where: { id: input.checkoutIntentId, shopId: input.shopId, customerProfileId: input.customerProfileId } });
  if (!checkout) throw new CodAdvanceRazorpayOrderError(404, "CHECKOUT_NOT_FOUND");
  if (checkout.selectedPaymentMethod !== "COD") throw new CodAdvanceRazorpayOrderError(409, "COD_PAYMENT_METHOD_REQUIRED");
  if (checkout.expiresAt && checkout.expiresAt <= now) throw new CodAdvanceRazorpayOrderError(409, "CHECKOUT_SESSION_EXPIRED");
  if (["EXPIRED", "ORDER_COMPLETED", "CANCELLED"].includes(checkout.status)) throw new CodAdvanceRazorpayOrderError(409, "CHECKOUT_NOT_PAYABLE");

  const policy = await (deps.resolvePolicy || resolveExpressCheckoutCodPolicy)(input, db, deps as any);
  if (!policy.codAdvanceIntentId || !policy.requiresAdvance) throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_NOT_REQUIRED");

  const codIntent = await db.codAdvanceIntent.findFirst({ where: { id: policy.codAdvanceIntentId, shopId: input.shopId, customerProfileId: input.customerProfileId, expressCheckoutIntentId: input.checkoutIntentId } });
  if (!codIntent) throw new CodAdvanceRazorpayOrderError(404, "COD_ADVANCE_INTENT_NOT_FOUND");
  if (!["CREATED", "PAYMENT_PENDING"].includes(codIntent.status) || codIntent.paidAt || codIntent.verifiedAt || codIntent.consumedAt || codIntent.shopifyDraftOrderId || codIntent.shopifyOrderId || codIntent.shopifyOrderName || codIntent.razorpayPaymentId) throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_INTENT_NOT_PAYABLE");
  if (codIntent.expiresAt && codIntent.expiresAt <= now) throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_INTENT_EXPIRED");
  if (codIntent.id !== policy.codAdvanceIntentId || codIntent.pricingFingerprint !== undefined && policy.codAdvanceIntentId !== codIntent.id) throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_POLICY_CHANGED");
  if (codIntent.settingsVersion !== undefined && codIntent.settingsVersion !== null && codIntent.settingsVersion !== (codIntent.settingsVersion)) throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_POLICY_CHANGED");
  if (codIntent.advanceAmountPaise !== policy.advanceAmountPaise || codIntent.codBalanceAmountPaise !== policy.codBalanceAmountPaise || codIntent.orderAmountPaise !== policy.orderTotalPaise || String(codIntent.currency || "INR").toUpperCase() !== String(policy.currency || "INR").toUpperCase()) throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_POLICY_CHANGED");
  return { checkout, codIntent, policy };
}

async function markFailed(db: any, paymentId: string, reason: string, payload?: unknown) {
  await db.expressCheckoutPayment.update({ where: { id: paymentId }, data: { status: "FAILED", failureReason: reason, rawGatewayPayload: payload === undefined ? undefined : safeJson(payload) } });
}

export async function createCodAdvanceRazorpayOrder(input: CreateCodAdvanceRazorpayOrderInput, deps: Deps = {}): Promise<CreateCodAdvanceRazorpayOrderResult> {
  const db = (deps.db || prisma) as any;
  await resolveActiveShop(input, deps);
  const keyId = deps.getKeyId ? deps.getKeyId() : getRazorpayCredentialsKeyId();

  const reservation = await db.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.shopId}:${input.checkoutIntentId}:cod_advance_razorpay_order`}))`;
    const validation = await validateLocal(input, tx, deps);
    const reusable = await tx.expressCheckoutPayment.findFirst({ where: { shopId: input.shopId, intentId: input.checkoutIntentId, purpose: "COD_ADVANCE", method: "COD", status: "PENDING", razorpayOrderId: { not: null }, amountPaise: validation.codIntent.advanceAmountPaise, currency: validation.codIntent.currency }, orderBy: { createdAt: "desc" } });
    if (reusable?.razorpayOrderId) return { ...validation, payment: reusable, reused: true };
    const inProgress = await tx.expressCheckoutPayment.findFirst({ where: { shopId: input.shopId, intentId: input.checkoutIntentId, purpose: "COD_ADVANCE", method: "COD", status: "PENDING", razorpayOrderId: null }, orderBy: { createdAt: "desc" } });
    if (inProgress) throw new CodAdvanceRazorpayOrderError(409, "PAYMENT_IN_PROGRESS");
    const payment = await tx.expressCheckoutPayment.create({ data: { shopId: input.shopId, intentId: input.checkoutIntentId, method: "COD", purpose: "COD_ADVANCE", status: "PENDING", amountPaise: validation.codIntent.advanceAmountPaise, currency: validation.codIntent.currency } });
    return { ...validation, payment, reused: false };
  });

  if (reservation.reused) return toResult(reservation, keyId, true);

  let providerOrder: JsonRecord | undefined;
  let validatedProviderOrder = false;
  try {
    providerOrder = await (deps.createGatewayOrder || defaultCreateGatewayOrder)({ amountPaise: reservation.codIntent.advanceAmountPaise, currency: reservation.codIntent.currency, receipt: `megaska_cod_${reservation.codIntent.id}`.slice(0, 40), notes: { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, codAdvanceIntentId: reservation.codIntent.id, paymentId: reservation.payment.id } });
    const providerId = String(providerOrder.id || "");
    const providerAmount = Number(providerOrder.amount);
    const providerCurrency = String(providerOrder.currency || "");
    if (!providerId || providerAmount !== reservation.codIntent.advanceAmountPaise || providerCurrency.toUpperCase() !== String(reservation.codIntent.currency).toUpperCase()) throw new CodAdvanceRazorpayOrderError(502, "RAZORPAY_ORDER_CREATION_FAILED", "Invalid Razorpay order response");
    validatedProviderOrder = true;

    const persisted = await db.$transaction(async (tx: any) => {
      const updatedPayment = await tx.expressCheckoutPayment.update({ where: { id: reservation.payment.id }, data: { razorpayOrderId: providerId, providerAmountPaise: providerAmount, providerCurrency, rawGatewayPayload: safeJson({ id: providerId, amount: providerAmount, currency: providerCurrency, status: providerOrder?.status || null }) } });
      const transition = await tx.codAdvanceIntent.updateMany({ where: { id: reservation.codIntent.id, shopId: input.shopId, status: { in: ["CREATED", "PAYMENT_PENDING"] }, paidAt: null, verifiedAt: null, consumedAt: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null }, data: { status: "PAYMENT_PENDING" } });
      if (transition.count !== 1) {
        await deps.audit?.("reconciliation.required", "ExpressCheckoutPayment", reservation.payment.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, codAdvanceIntentId: reservation.codIntent.id, razorpayOrderId: providerId });
        throw new CodAdvanceRazorpayOrderError(503, "COD_ADVANCE_RECONCILIATION_REQUIRED");
      }
      return updatedPayment;
    });
    return toResult({ ...reservation, payment: persisted }, keyId, false);
  } catch (error) {
    if (validatedProviderOrder && providerOrder) {
      await deps.audit?.("reconciliation.required", "ExpressCheckoutPayment", reservation.payment.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, codAdvanceIntentId: reservation.codIntent.id, providerOrder: safeJson(providerOrder) }).catch(() => undefined);
    } else {
      await markFailed(db, reservation.payment.id, safeFailure(error), providerOrder).catch(() => undefined);
    }
    if (error instanceof CodAdvanceRazorpayOrderError && error.code === "COD_ADVANCE_RECONCILIATION_REQUIRED") throw error;
    throw new CodAdvanceRazorpayOrderError(502, "RAZORPAY_ORDER_CREATION_FAILED");
  }
}

function toResult(reservation: any, keyId: string, reused: boolean): CreateCodAdvanceRazorpayOrderResult {
  return {
    razorpayOrder: { id: reservation.payment.razorpayOrderId, amount: reservation.payment.providerAmountPaise ?? reservation.payment.amountPaise, currency: reservation.payment.providerCurrency ?? reservation.payment.currency, keyId },
    cod: { codAdvanceIntentId: reservation.codIntent.id, advanceAmountPaise: reservation.codIntent.advanceAmountPaise, codBalanceAmountPaise: reservation.codIntent.codBalanceAmountPaise, orderTotalPaise: reservation.codIntent.orderAmountPaise, storeCreditAppliedPaise: reservation.codIntent.storeCreditAppliedPaise || 0 },
    paymentId: reservation.payment.id,
    reused,
  };
}
