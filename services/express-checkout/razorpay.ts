import crypto from "crypto";
import { prisma } from "../db/prisma";
import { getShopByDomain, normalizeShopDomain, ShopResolutionError } from "../shopify/shop";
import { ExpressCheckoutOrderFinalizationError, finalizePrepaidExpressCheckoutOrder } from "./order-finalization";
import { CheckoutStateDb, transitionCheckoutIntent } from "../../lib/express-checkout/state-machine";
import { CHECKOUT_INTENT_EXPIRY_MESSAGE, markCheckoutIntentExpiredIfNeeded } from "../../lib/express-checkout/expiry";
import { getActiveStoreCreditReservation, releaseStoreCreditReservation } from "./store-credit";

type JsonRecord = Record<string, unknown>;

type CreateParams = {
  shopDomain: string;
  intentId: string;
  customerProfileId?: string | null;
};

type VerifyParams = CreateParams & {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export class ExpressCheckoutRazorpayError extends Error {
  status: number;
  publicMessage: string;
  stage: string;
  code: string;

  constructor(status: number, publicMessage: string, message = publicMessage, code = "RAZORPAY_ORDER_CREATE_FAILED", stage = "RAZORPAY_ORDER_CREATE") {
    super(message);
    this.name = "ExpressCheckoutRazorpayError";
    this.status = status;
    this.publicMessage = publicMessage;
    this.stage = stage;
    this.code = code;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function cartLineItemCount(cartSnapshot: unknown) {
  const snapshot = asRecord(cartSnapshot);
  return Array.isArray(snapshot?.lineItems)
    ? snapshot.lineItems.length
    : Array.isArray(snapshot?.items)
      ? snapshot.items.length
      : Array.isArray(snapshot?.lines)
        ? snapshot.lines.length
        : Array.isArray(cartSnapshot)
          ? cartSnapshot.length
          : 0;
}

async function resolveActiveShop(shopDomain: string) {
  const normalized = normalizeShopDomain(shopDomain);
  const shop = await getShopByDomain(normalized);

  if (!shop) throw new ShopResolutionError(404, "Shop not found");
  if (!shop.isActive || shop.uninstalledAt) throw new ShopResolutionError(403, "Shop is inactive");

  return shop;
}

function getRazorpayCredentials() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();

  if (!keyId || !keySecret) {
    throw new ExpressCheckoutRazorpayError(503, "Could not start secure payment. Please try again.", "Razorpay credentials are not configured", "RAZORPAY_NOT_CONFIGURED");
  }

  return { keyId, keySecret };
}

async function createGatewayOrder(input: { amountPaise: number; currency: string; receipt: string; notes: JsonRecord }) {
  const { keyId, keySecret } = getRazorpayCredentials();
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !asRecord(payload)?.id) {
    throw new ExpressCheckoutRazorpayError(502, "Could not start secure payment. Please try again.", "Razorpay order creation failed", "RAZORPAY_ORDER_API_FAILED");
  }

  return payload as JsonRecord & { id: string; amount?: number; currency?: string };
}

function timingSafeSignatureEqual(expectedHex: string, actualHex: string) {
  if (!/^[a-f0-9]+$/i.test(actualHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function signatureHash(signature: string) {
  return crypto.createHash("sha256").update(signature).digest("hex");
}


async function fetchGatewayPaymentAmountPaise(paymentId: string) {
  const { keyId, keySecret } = getRazorpayCredentials();
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ExpressCheckoutRazorpayError(502, "Could not verify payment. Please contact support if money was deducted.", "Razorpay payment lookup failed", "RAZORPAY_PAYMENT_LOOKUP_FAILED", "RAZORPAY_VERIFY");
  }
  const amount = Number(asRecord(payload)?.amount);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount);
}


function safePaymentPayload(params: VerifyParams, valid: boolean) {
  return {
    razorpay_order_id: params.razorpay_order_id,
    razorpay_payment_id: params.razorpay_payment_id,
    razorpay_signature_hash: signatureHash(params.razorpay_signature),
    signatureValid: valid,
  };
}

async function loadValidatedIntent(params: CreateParams, shopId: string) {
  const intent = await prisma.expressCheckoutIntent.findFirst({
    where: {
      shopId,
      id: params.intentId,
      ...(params.customerProfileId ? { customerProfileId: params.customerProfileId } : {}),
    },
    include: { addressSnapshots: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (!intent) throw new ExpressCheckoutRazorpayError(404, "Could not start secure payment. Please try again.", "Intent not found");
  if (intent.status === "ORDER_COMPLETED") throw new ExpressCheckoutRazorpayError(409, "Could not start secure payment. Please try again.", "Intent already completed", "CHECKOUT_INTENT_COMPLETED");
  if (intent.status === "EXPIRED" || await markCheckoutIntentExpiredIfNeeded(intent)) throw new ExpressCheckoutRazorpayError(409, CHECKOUT_INTENT_EXPIRY_MESSAGE, "Intent expired", "CHECKOUT_SESSION_EXPIRED");
  if (intent.selectedPaymentMethod !== "PREPAID") throw new ExpressCheckoutRazorpayError(409, "Could not start secure payment. Please try again.", "PREPAID payment method required");
  if (!Number.isFinite(intent.totalAmountPaise) || intent.totalAmountPaise <= 0) throw new ExpressCheckoutRazorpayError(400, "Could not start secure payment. Please try again.", "Invalid prepaid amount");
  if (!intent.customerProfileId) throw new ExpressCheckoutRazorpayError(409, "Could not start secure payment. Please try again.", "Customer profile required");
  if (cartLineItemCount(intent.cartSnapshot) <= 0) throw new ExpressCheckoutRazorpayError(409, "Could not start secure payment. Please try again.", "Cart snapshot required");
  if (intent.addressSnapshots.length <= 0) throw new ExpressCheckoutRazorpayError(409, "Could not start secure payment. Please try again.", "Address snapshot required");

  return intent;
}

export async function createExpressCheckoutRazorpayOrder(params: CreateParams) {
  console.info("[EXPRESS RAZORPAY] order_create_start", { intentId: params.intentId, shopDomain: normalizeShopDomain(params.shopDomain) });

  const shop = await resolveActiveShop(params.shopDomain);
  const intent = await loadValidatedIntent(params, shop.id);
  const address = intent.addressSnapshots[0];
  const storeCreditReservation = await getActiveStoreCreditReservation({ shopId: shop.id, customerProfileId: String(intent.customerProfileId || ""), checkoutIntentId: intent.id });
  const storeCreditAmountPaise = Math.min(Number(storeCreditReservation?.reservedAmount || 0), Math.max(0, intent.totalAmountPaise));
  const remainingAmountPaise = Math.max(0, intent.totalAmountPaise - storeCreditAmountPaise);
  if (remainingAmountPaise <= 0) throw new ExpressCheckoutRazorpayError(409, "No online payment is required after Megaska Store Credit.", "Store Credit covers checkout", "STORE_CREDIT_FULL_COVERAGE");
  const { keyId } = getRazorpayCredentials();

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${shop.id}:${intent.id}:razorpay_order`}))`;

      const reusablePayment = await tx.expressCheckoutPayment.findFirst({
        where: {
          shopId: shop.id,
          intentId: intent.id,
          method: "PREPAID",
          razorpayOrderId: { not: null },
          amountPaise: remainingAmountPaise,
          currency: intent.currency,
        },
        orderBy: { createdAt: "desc" },
      });

      if (reusablePayment?.razorpayOrderId) {
        await tx.expressCheckoutIntent.updateMany({ where: { shopId: shop.id, id: intent.id, status: { notIn: ["ORDER_COMPLETED", "EXPIRED"] } }, data: { status: "PAYMENT_PENDING" } });
        console.info("[CHECKOUT STATE] razorpay_order_idempotent_return", { shopId: shop.id, intentId: intent.id, paymentId: reusablePayment.id, razorpayOrderId: reusablePayment.razorpayOrderId });
        return {
          key: keyId,
          razorpayOrderId: reusablePayment.razorpayOrderId,
          amountPaise: reusablePayment.amountPaise,
          currency: reusablePayment.currency,
          intentId: intent.id,
          paymentId: reusablePayment.id,
          customer: { name: address.name, email: address.email, phone: address.phone },
          notes: { intentId: intent.id, shopId: shop.id, paymentId: reusablePayment.id },
        };
      }

      const payment = await tx.expressCheckoutPayment.create({
        data: { shopId: shop.id, intentId: intent.id, method: "PREPAID", status: "PENDING", amountPaise: remainingAmountPaise, currency: intent.currency },
      });
      const notes = { intentId: intent.id, shopId: shop.id, paymentId: payment.id };
      const razorpayOrder = await createGatewayOrder({ amountPaise: remainingAmountPaise, currency: intent.currency, receipt: `megaska_express_${intent.id}`.slice(0, 40), notes: { ...notes, storeCreditAmountPaise, walletReservationId: storeCreditReservation?.id || null } });
      const updatedPayment = await tx.expressCheckoutPayment.update({
        where: { id: payment.id },
        data: { razorpayOrderId: razorpayOrder.id, rawGatewayPayload: safeJson(razorpayOrder) },
      });
      await tx.expressCheckoutIntent.updateMany({ where: { shopId: shop.id, id: intent.id, status: { notIn: ["ORDER_COMPLETED", "EXPIRED"] } }, data: { status: "PAYMENT_PENDING" } });
      console.info("[CHECKOUT STATE] razorpay_order_created", { shopId: shop.id, intentId: intent.id, paymentId: payment.id, razorpayOrderId: razorpayOrder.id });

      return {
        key: keyId,
        razorpayOrderId: razorpayOrder.id,
        amountPaise: updatedPayment.amountPaise,
        currency: updatedPayment.currency,
        intentId: intent.id,
        paymentId: updatedPayment.id,
        customer: { name: address.name, email: address.email, phone: address.phone },
        notes,
      };
    }, { timeout: 15000 });
  } catch (error) {
    console.error("[EXPRESS RAZORPAY] order_create_failed", { shopId: shop.id, intentId: intent.id, errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : "Unknown error" });
    throw error;
  }
}

async function finalizeConfirmedRazorpayPayment(input: {
  shopId: string;
  shopDomain: string;
  intent: { id: string; shopId: string; customerProfileId?: string | null; status: string };
  payment: { id: string; razorpayOrderId?: string | null; razorpayPaymentId?: string | null };
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  reason: string;
}) {
  const existingLink = await prisma.expressCheckoutOrderLink.findFirst({ where: { shopId: input.shopId, intentId: input.intent.id } });
  if (existingLink?.shopifyOrderId || existingLink?.shopifyOrderName) {
    if (input.intent.status !== "ORDER_COMPLETED") {
      await transitionCheckoutIntent({ db: prisma as unknown as CheckoutStateDb, intent: { id: input.intent.id, shopId: input.intent.shopId, status: input.intent.status }, toStatus: "ORDER_COMPLETED", reason: `${input.reason}_existing_order_completed`, metadata: { paymentId: input.payment.id, shopifyOrderId: existingLink.shopifyOrderId || null } });
    }
    console.info("[EXPRESS PREPAID FINALIZATION] existing_order_link_returned", { shopId: input.shopId, intentId: input.intent.id, paymentId: input.payment.id, razorpayOrderId: input.razorpayOrderId || input.payment.razorpayOrderId || null, razorpayPaymentId: input.razorpayPaymentId || input.payment.razorpayPaymentId || null, reason: input.reason });
    return { ok: true, intentId: input.intent.id, paymentId: input.payment.id, orderLink: existingLink, shopifyOrder: null, status: "ORDER_COMPLETED", idempotent: true };
  }

  console.info("[EXPRESS PREPAID FINALIZATION] confirmed_payment_recovery_start", { shopId: input.shopId, intentId: input.intent.id, paymentId: input.payment.id, razorpayOrderId: input.razorpayOrderId || input.payment.razorpayOrderId || null, razorpayPaymentId: input.razorpayPaymentId || input.payment.razorpayPaymentId || null, intentStatus: input.intent.status, reason: input.reason });
  try {
    const finalization = await finalizePrepaidExpressCheckoutOrder({
      shopId: input.shopId,
      shopDomain: input.shopDomain,
      intentId: input.intent.id,
      customerProfileId: String(input.intent.customerProfileId || ""),
      paymentId: input.payment.id,
      razorpayOrderId: input.razorpayOrderId || input.payment.razorpayOrderId || null,
      razorpayPaymentId: input.razorpayPaymentId || input.payment.razorpayPaymentId || null,
    });
    return { ...finalization, intentId: input.intent.id, paymentId: input.payment.id, status: "ORDER_COMPLETED", idempotent: finalization.idempotent };
  } catch (error) {
    if (error instanceof ExpressCheckoutOrderFinalizationError) throw new ExpressCheckoutRazorpayError(error.status, error.publicMessage, error.message, "SHOPIFY_FINALIZATION_FAILED", "ORDER_FINALIZATION");
    throw error;
  }
}

export async function recoverExpressCheckoutRazorpayOrder(params: { shopDomain: string; intentId?: string; razorpayPaymentId?: string; razorpayOrderId?: string }) {
  const shop = await resolveActiveShop(params.shopDomain);
  const payment = await prisma.expressCheckoutPayment.findFirst({
    where: {
      shopId: shop.id,
      method: "PREPAID",
      status: "CONFIRMED",
      ...(params.intentId ? { intentId: params.intentId } : {}),
      ...(params.razorpayPaymentId ? { razorpayPaymentId: params.razorpayPaymentId } : {}),
      ...(params.razorpayOrderId ? { razorpayOrderId: params.razorpayOrderId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!payment) throw new ExpressCheckoutRazorpayError(404, "Confirmed payment not found for recovery.", "Confirmed Razorpay payment not found", "RAZORPAY_PAYMENT_NOT_FOUND", "ORDER_RECOVERY");
  const intent = await prisma.expressCheckoutIntent.findFirst({ where: { shopId: shop.id, id: payment.intentId }, include: { orderLink: true } });
  if (!intent) throw new ExpressCheckoutRazorpayError(404, "Checkout intent not found for recovery.", "Intent not found", "CHECKOUT_INTENT_NOT_FOUND", "ORDER_RECOVERY");
  return finalizeConfirmedRazorpayPayment({ shopId: shop.id, shopDomain: shop.shopDomain, intent, payment, razorpayOrderId: payment.razorpayOrderId, razorpayPaymentId: payment.razorpayPaymentId, reason: "admin_recovery" });
}

export async function verifyExpressCheckoutRazorpayPayment(params: VerifyParams) {
  console.info("[EXPRESS RAZORPAY] verify_start", { intentId: params.intentId, shopDomain: normalizeShopDomain(params.shopDomain), razorpayOrderId: params.razorpay_order_id });

  const shop = await resolveActiveShop(params.shopDomain);
  const intent = await prisma.expressCheckoutIntent.findFirst({
    where: { shopId: shop.id, id: params.intentId, ...(params.customerProfileId ? { customerProfileId: params.customerProfileId } : {}) },
    include: { orderLink: true },
  });
  if (!intent) throw new ExpressCheckoutRazorpayError(404, "Could not verify payment. Please contact support if money was deducted.", "Intent not found", "CHECKOUT_INTENT_NOT_FOUND", "RAZORPAY_VERIFY");

  const payment = await prisma.expressCheckoutPayment.findFirst({ where: { shopId: shop.id, intentId: intent.id, method: "PREPAID", razorpayOrderId: params.razorpay_order_id }, orderBy: { createdAt: "desc" } });

  if (intent.status === "ORDER_COMPLETED") {
    console.info("[CHECKOUT STATE] payment_duplicate_callback_ignored", { shopId: shop.id, intentId: intent.id, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id, hasOrderLink: Boolean(intent.orderLink), paymentId: payment?.id || null });
    if (!intent.orderLink && payment?.status === "CONFIRMED") return finalizeConfirmedRazorpayPayment({ shopId: shop.id, shopDomain: shop.shopDomain, intent, payment, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id, reason: "order_completed_missing_link" });
    return { ok: true, intentId: intent.id, paymentId: payment?.id || null, orderLink: intent.orderLink, shopifyOrder: null, status: "ORDER_COMPLETED", idempotent: true };
  }
  if (intent.status === "EXPIRED" || await markCheckoutIntentExpiredIfNeeded(intent)) throw new ExpressCheckoutRazorpayError(409, CHECKOUT_INTENT_EXPIRY_MESSAGE, "Intent expired", "CHECKOUT_SESSION_EXPIRED", "RAZORPAY_VERIFY");
  if (payment?.status === "CONFIRMED" || intent.status === "PAYMENT_SUCCESS") {
    if (!payment) throw new ExpressCheckoutRazorpayError(400, "Could not verify payment. Please contact support if money was deducted.", "Submitted Razorpay order id does not match checkout", "RAZORPAY_ORDER_MISMATCH", "RAZORPAY_VERIFY");
    if (payment.razorpayPaymentId && payment.razorpayPaymentId !== params.razorpay_payment_id) {
      console.error("[EXPRESS RAZORPAY] verify_failed", { shopId: shop.id, intentId: intent.id, paymentId: payment.id, reason: "conflicting_payment_id" });
      throw new ExpressCheckoutRazorpayError(409, "Could not verify payment. Please contact support if money was deducted.", "Conflicting Razorpay payment id", "RAZORPAY_PAYMENT_CONFLICT", "RAZORPAY_VERIFY");
    }
    return finalizeConfirmedRazorpayPayment({ shopId: shop.id, shopDomain: shop.shopDomain, intent, payment, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id, reason: payment.status === "CONFIRMED" ? "confirmed_payment_retry" : "payment_success_retry" });
  }
  if (intent.status !== "PAYMENT_PENDING") throw new ExpressCheckoutRazorpayError(409, "Could not verify payment. Please contact support if money was deducted.", `Intent status ${intent.status} cannot verify payment`, "INVALID_CHECKOUT_STATE", "RAZORPAY_VERIFY");

  if (!payment) throw new ExpressCheckoutRazorpayError(400, "Could not verify payment. Please contact support if money was deducted.", "Submitted Razorpay order id does not match checkout", "RAZORPAY_ORDER_MISMATCH", "RAZORPAY_VERIFY");
  if (payment.razorpayOrderId !== params.razorpay_order_id) throw new ExpressCheckoutRazorpayError(400, "Could not verify payment. Please contact support if money was deducted.", "Razorpay order mismatch", "RAZORPAY_ORDER_MISMATCH", "RAZORPAY_VERIFY");
  if (payment.razorpayPaymentId && payment.razorpayPaymentId !== params.razorpay_payment_id) {
    console.error("[EXPRESS RAZORPAY] verify_failed", { shopId: shop.id, intentId: intent.id, paymentId: payment.id, reason: "conflicting_payment_id" });
    throw new ExpressCheckoutRazorpayError(409, "Could not verify payment. Please contact support if money was deducted.", "Conflicting Razorpay payment id", "RAZORPAY_PAYMENT_CONFLICT", "RAZORPAY_VERIFY");
  }

  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!keySecret) throw new ExpressCheckoutRazorpayError(503, "Could not verify payment. Please contact support if money was deducted.", "Razorpay secret is not configured", "RAZORPAY_NOT_CONFIGURED", "RAZORPAY_VERIFY");

  const expected = crypto.createHmac("sha256", keySecret).update(`${params.razorpay_order_id}|${params.razorpay_payment_id}`).digest("hex");
  const valid = timingSafeSignatureEqual(expected, params.razorpay_signature);

  if (!valid) {
    await prisma.$transaction(async (tx) => {
      await tx.expressCheckoutPayment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: "Invalid Razorpay signature", rawGatewayPayload: safeJson(safePaymentPayload(params, false)) } });
      await transitionCheckoutIntent({ db: tx as unknown as CheckoutStateDb, intent: { id: intent.id, shopId: intent.shopId, status: intent.status }, toStatus: "PAYMENT_FAILED", reason: "razorpay_signature_failed", metadata: { paymentId: payment.id } });
    });
    await releaseStoreCreditReservation({ shopId: shop.id, customerProfileId: String(intent.customerProfileId || ""), checkoutIntentId: intent.id, reason: "razorpay-signature-failed" });
    console.error("[EXPRESS RAZORPAY] verify_failed", { shopId: shop.id, intentId: intent.id, paymentId: payment.id, reason: "invalid_signature" });
    throw new ExpressCheckoutRazorpayError(400, "Payment verification failed. Please retry or contact support if money was deducted.", "Invalid Razorpay signature", "RAZORPAY_SIGNATURE_INVALID", "RAZORPAY_VERIFY");
  }

  const paidAmountPaise = await fetchGatewayPaymentAmountPaise(params.razorpay_payment_id);
  if (paidAmountPaise !== null && paidAmountPaise !== payment.amountPaise) {
    await releaseStoreCreditReservation({ shopId: shop.id, customerProfileId: String(intent.customerProfileId || ""), checkoutIntentId: intent.id, reason: "razorpay-amount-mismatch" });
    console.error("[EXPRESS RAZORPAY] verify_failed", { shopId: shop.id, intentId: intent.id, paymentId: payment.id, reason: "amount_mismatch", expectedAmountPaise: payment.amountPaise, paidAmountPaise });
    throw new ExpressCheckoutRazorpayError(400, "Payment verification failed. Please contact support if money was deducted.", "Razorpay amount mismatch", "RAZORPAY_AMOUNT_MISMATCH", "RAZORPAY_VERIFY");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.expressCheckoutPayment.update({
      where: { id: payment.id },
      data: { status: "CONFIRMED", razorpayPaymentId: payment.razorpayPaymentId || params.razorpay_payment_id, razorpaySignatureHash: signatureHash(params.razorpay_signature), rawGatewayPayload: safeJson({ ...safePaymentPayload(params, true), paidAmountPaise }), failureReason: null },
    });
    const transition = await transitionCheckoutIntent({ db: tx as unknown as CheckoutStateDb, intent: { id: intent.id, shopId: intent.shopId, status: intent.status }, toStatus: "PAYMENT_SUCCESS", reason: "razorpay_payment_verified", metadata: { paymentId: payment.id, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id } });
    if (!transition.ok) throw new ExpressCheckoutRazorpayError(409, "Could not verify payment. Please contact support if money was deducted.", `Intent status ${transition.fromStatus} cannot verify payment`, "INVALID_CHECKOUT_STATE", "RAZORPAY_VERIFY");
    return updatedPayment;
  });

  console.info("[EXPRESS RAZORPAY] verify_success", { shopId: shop.id, intentId: intent.id, paymentId: updated.id });
  const existingLink = await prisma.expressCheckoutOrderLink.findFirst({ where: { shopId: shop.id, intentId: intent.id } });
  if (existingLink?.shopifyOrderId || existingLink?.shopifyOrderName) {
    await transitionCheckoutIntent({ db: prisma as unknown as CheckoutStateDb, intent: { id: intent.id, shopId: intent.shopId, status: "PAYMENT_SUCCESS" }, toStatus: "ORDER_COMPLETED", reason: "razorpay_existing_order_completed", metadata: { paymentId: updated.id, shopifyOrderId: existingLink.shopifyOrderId || null } });
    console.info("[EXPRESS PREPAID FINALIZATION] existing_order_link_returned", { shopId: shop.id, intentId: intent.id, paymentId: updated.id, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id });
    return { ok: true, intentId: intent.id, paymentId: updated.id, orderLink: existingLink, shopifyOrder: null, status: "ORDER_COMPLETED", idempotent: true };
  }

  console.info("[EXPRESS PREPAID FINALIZATION] payment_confirmed", { shopId: shop.id, intentId: intent.id, paymentId: updated.id, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id, idempotent: false });

  try {
    const finalization = await finalizePrepaidExpressCheckoutOrder({ shopId: shop.id, shopDomain: shop.shopDomain, intentId: intent.id, customerProfileId: String(intent.customerProfileId || ""), paymentId: updated.id, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id });
    return { ...finalization, intentId: intent.id, paymentId: updated.id, status: "ORDER_COMPLETED", idempotent: finalization.idempotent };
  } catch (error) {
    if (error instanceof ExpressCheckoutOrderFinalizationError) throw new ExpressCheckoutRazorpayError(error.status, error.publicMessage, error.message, "SHOPIFY_FINALIZATION_FAILED", "ORDER_FINALIZATION");
    throw error;
  }
}
