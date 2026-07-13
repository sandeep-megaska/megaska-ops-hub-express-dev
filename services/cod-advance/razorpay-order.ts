/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "../db/prisma.ts";

export const COD_ADVANCE_RAZORPAY_ORDER_REUSE_WINDOW_MS = 15 * 60_000;

export class CodAdvanceRazorpayOrderError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CodAdvanceRazorpayOrderError";
    this.status = status;
    this.code = code;
  }
}

type Db = any;
type RazorpayOrder = { id?: string; amount?: number | string | null; currency?: string | null; [key: string]: unknown };

type Deps = {
  db?: Db;
  createGatewayOrder?: (input: { amountPaise: number; currency: string; receipt: string; notes: Record<string, unknown> }) => Promise<RazorpayOrder>;
  audit?: (eventType: string, entityType: string, entityId: string | null, payload?: unknown) => Promise<void>;
  now?: () => Date;
  keyId?: string;
};

type Params = { shopId: string; checkoutIntentId: string; codAdvanceIntentId: string };

function getRazorpayKeyId() {
  return String(process.env.RAZORPAY_KEY_ID || "").trim();
}

async function defaultCreateGatewayOrder(input: { amountPaise: number; currency: string; receipt: string; notes: Record<string, unknown> }) {
  const keyId = getRazorpayKeyId();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!keyId || !keySecret) throw new Error("Razorpay credentials are not configured");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.receipt, notes: input.notes }),
  });
  const data = (await response.json().catch(() => null)) as RazorpayOrder | null;
  if (!response.ok || !data) throw new Error(`Failed to create COD advance Razorpay order (${response.status})`);
  return data;
}

function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function safeFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown Razorpay order creation failure");
  return message.slice(0, 500);
}

function isReusablePayment(payment: any, input: { shopId: string; checkoutIntentId: string; amountPaise: number; currency: string; now: Date }) {
  if (!payment) return false;
  const createdAt = payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt || 0);
  return payment.shopId === input.shopId
    && payment.intentId === input.checkoutIntentId
    && payment.purpose === "COD_ADVANCE"
    && payment.method === "COD"
    && payment.status === "PENDING"
    && payment.amountPaise === input.amountPaise
    && String(payment.currency || "").toUpperCase() === input.currency.toUpperCase()
    && Boolean(payment.razorpayOrderId)
    && payment.razorpayPaymentId == null
    && (payment.providerAmountPaise == null || payment.providerAmountPaise === input.amountPaise)
    && (payment.providerCurrency == null || String(payment.providerCurrency).toUpperCase() === input.currency.toUpperCase())
    && input.now.getTime() - createdAt.getTime() <= COD_ADVANCE_RAZORPAY_ORDER_REUSE_WINDOW_MS;
}

async function markPaymentFailedOrReconciliation(input: { tx: Db; audit: Deps["audit"]; paymentId: string; shopId: string; codAdvanceIntentId: string; razorpayOrderId?: string | null; reason: string; code: string }) {
  try {
    await input.tx.expressCheckoutPayment.update({ where: { id: input.paymentId }, data: { status: "FAILED", failureReason: `${input.code}:${input.reason}`.slice(0, 500) } });
  } catch (error) {
    await input.audit?.("cod_advance.reconciliation.required", "CodAdvanceIntent", input.codAdvanceIntentId, { shopId: input.shopId, paymentId: input.paymentId, razorpayOrderId: input.razorpayOrderId || null, reason: input.reason, failureUpdateError: safeFailureReason(error) }).catch(() => undefined);
  }
}

function validateProviderOrder(order: RazorpayOrder, cod: any) {
  if (!order.id) return "missing_order_id";
  if (order.amount != null && Number(order.amount) !== cod.advanceAmountPaise) return "amount_mismatch";
  if (order.currency != null && String(order.currency).toUpperCase() !== String(cod.currency).toUpperCase()) return "currency_mismatch";
  return null;
}

export async function createCodAdvanceRazorpayOrder(params: Params, deps: Deps = {}) {
  const db = deps.db || prisma;
  const audit = deps.audit || (async (eventType: string, entityType: string, entityId: string | null, payload?: unknown) => { await db.auditEvent.create({ data: { actorType: "system", eventType, entityType, entityId, payload } }); });
  const createGatewayOrder = deps.createGatewayOrder || defaultCreateGatewayOrder;
  const keyId = deps.keyId ?? getRazorpayKeyId();

  return db.$transaction(async (tx: Db) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${params.shopId}:${params.checkoutIntentId}:cod_advance_razorpay_order`}))`;

    const checkout = await tx.expressCheckoutIntent.findFirst({ where: { id: params.checkoutIntentId, shopId: params.shopId } });
    if (!checkout) throw new CodAdvanceRazorpayOrderError(404, "CHECKOUT_NOT_FOUND", "Checkout intent not found");
    if (!["PAYMENT_SELECTED", "PAYMENT_PENDING"].includes(checkout.status)) throw new CodAdvanceRazorpayOrderError(409, "CHECKOUT_STATUS_INVALID", "Checkout is not ready for COD advance payment");
    // PAYMENT_PENDING is accepted only for recovery/idempotent retries; the reusable-payment check below must win before any new order is created.

    const cod = await tx.codAdvanceIntent.findFirst({ where: { id: params.codAdvanceIntentId, shopId: params.shopId, expressCheckoutIntentId: params.checkoutIntentId } });
    if (!cod) throw new CodAdvanceRazorpayOrderError(404, "COD_ADVANCE_INTENT_NOT_FOUND", "COD advance intent not found");
    if (!["CREATED", "PAYMENT_PENDING"].includes(cod.status)) throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_STATUS_INVALID", "COD advance is not ready for payment");
    if (!Number.isFinite(cod.advanceAmountPaise) || cod.advanceAmountPaise <= 0) throw new CodAdvanceRazorpayOrderError(400, "COD_ADVANCE_AMOUNT_INVALID", "COD advance amount is invalid");

    const now = deps.now?.() || new Date();
    const reusablePayment = await tx.expressCheckoutPayment.findFirst({
      where: { shopId: params.shopId, intentId: params.checkoutIntentId, purpose: "COD_ADVANCE", method: "COD", status: "PENDING", amountPaise: cod.advanceAmountPaise, currency: cod.currency, razorpayOrderId: { not: null }, razorpayPaymentId: null },
      orderBy: { createdAt: "desc" },
    });
    if (isReusablePayment(reusablePayment, { shopId: params.shopId, checkoutIntentId: params.checkoutIntentId, amountPaise: cod.advanceAmountPaise, currency: cod.currency, now })) {
      return { key: keyId, razorpayOrderId: reusablePayment.razorpayOrderId, amountPaise: reusablePayment.amountPaise, currency: reusablePayment.currency, checkoutIntentId: params.checkoutIntentId, codAdvanceIntentId: cod.id, paymentId: reusablePayment.id, idempotent: true };
    }
    if (checkout.status === "PAYMENT_PENDING") throw new CodAdvanceRazorpayOrderError(409, "COD_ADVANCE_ORDER_NOT_REUSABLE", "Existing COD advance order is not reusable");

    const payment = await tx.expressCheckoutPayment.create({ data: { shopId: params.shopId, intentId: params.checkoutIntentId, purpose: "COD_ADVANCE", method: "COD", status: "PENDING", amountPaise: cod.advanceAmountPaise, currency: cod.currency } });
    let order: RazorpayOrder;
    try {
      order = await createGatewayOrder({ amountPaise: cod.advanceAmountPaise, currency: cod.currency, receipt: `megaska_cod_${cod.id}`.slice(0, 40), notes: { shopId: params.shopId, checkoutIntentId: params.checkoutIntentId, codAdvanceIntentId: cod.id, paymentId: payment.id } });
    } catch (error) {
      await markPaymentFailedOrReconciliation({ tx, audit, paymentId: payment.id, shopId: params.shopId, codAdvanceIntentId: cod.id, reason: safeFailureReason(error), code: "RAZORPAY_ORDER_CREATION_FAILED" });
      await audit("cod_advance.razorpay_order.failed", "CodAdvanceIntent", cod.id, { shopId: params.shopId, paymentId: payment.id, reason: safeFailureReason(error) }).catch(() => undefined);
      throw new CodAdvanceRazorpayOrderError(502, "RAZORPAY_ORDER_CREATION_FAILED", "Could not create COD advance payment order");
    }

    const validationError = validateProviderOrder(order, cod);
    if (validationError) {
      await markPaymentFailedOrReconciliation({ tx, audit, paymentId: payment.id, shopId: params.shopId, codAdvanceIntentId: cod.id, razorpayOrderId: order.id || null, reason: validationError, code: "RAZORPAY_ORDER_CREATION_FAILED" });
      await audit("cod_advance.razorpay_order.failed", "CodAdvanceIntent", cod.id, { shopId: params.shopId, paymentId: payment.id, razorpayOrderId: order.id || null, reason: validationError }).catch(() => undefined);
      throw new CodAdvanceRazorpayOrderError(502, "RAZORPAY_ORDER_CREATION_FAILED", "Could not create COD advance payment order");
    }

    const updatedPayment = await tx.expressCheckoutPayment.update({ where: { id: payment.id }, data: { razorpayOrderId: order.id, providerAmountPaise: order.amount == null ? null : Number(order.amount), providerCurrency: order.currency == null ? null : String(order.currency), rawGatewayPayload: safeJson(order) } });
    const transition = await tx.codAdvanceIntent.updateMany({
      where: { id: cod.id, shopId: params.shopId, status: { in: ["CREATED", "PAYMENT_PENDING"] }, paidAt: null, verifiedAt: null, consumedAt: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null },
      data: { status: "PAYMENT_PENDING", providerReferenceId: order.id },
    });
    if (transition.count !== 1) {
      await audit("cod_advance.reconciliation.required", "CodAdvanceIntent", cod.id, { shopId: params.shopId, paymentId: payment.id, razorpayOrderId: order.id, reason: "cod_advance_transition_count_mismatch", count: transition.count }).catch(() => undefined);
      throw new CodAdvanceRazorpayOrderError(503, "COD_ADVANCE_RECONCILIATION_REQUIRED", "COD advance payment requires reconciliation");
    }

    return { key: keyId, razorpayOrderId: String(order.id), amountPaise: updatedPayment.amountPaise, currency: updatedPayment.currency, checkoutIntentId: params.checkoutIntentId, codAdvanceIntentId: cod.id, paymentId: updatedPayment.id, idempotent: false };
  }, { timeout: 15000 });
}
