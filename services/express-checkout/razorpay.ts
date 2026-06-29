import crypto from "crypto";
import { prisma } from "../db/prisma";
import { getShopByDomain, normalizeShopDomain, ShopResolutionError } from "../shopify/shop";
import { ExpressCheckoutOrderFinalizationError, finalizePrepaidExpressCheckoutOrder } from "./order-finalization";

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
  if (intent.expiresAt && intent.expiresAt <= new Date()) throw new ExpressCheckoutRazorpayError(409, "Could not start secure payment. Please try again.", "Intent expired");
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
  const { keyId } = getRazorpayCredentials();

  const reusablePayment = await prisma.expressCheckoutPayment.findFirst({
    where: {
      shopId: shop.id,
      intentId: intent.id,
      method: "PREPAID",
      status: "PENDING",
      razorpayOrderId: { not: null },
      amountPaise: intent.totalAmountPaise,
      currency: intent.currency,
    },
    orderBy: { createdAt: "desc" },
  });

  if (reusablePayment?.razorpayOrderId) {
    await prisma.expressCheckoutIntent.updateMany({ where: { shopId: shop.id, id: intent.id }, data: { status: "PAYMENT_PENDING" } });
    console.info("[EXPRESS RAZORPAY] order_create_success", { shopId: shop.id, intentId: intent.id, paymentId: reusablePayment.id, reused: true });
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

  const payment = await prisma.expressCheckoutPayment.create({
    data: { shopId: shop.id, intentId: intent.id, method: "PREPAID", status: "PENDING", amountPaise: intent.totalAmountPaise, currency: intent.currency },
  });
  const notes = { intentId: intent.id, shopId: shop.id, paymentId: payment.id };

  try {
    const razorpayOrder = await createGatewayOrder({ amountPaise: intent.totalAmountPaise, currency: intent.currency, receipt: `megaska_express_${intent.id}`.slice(0, 40), notes });
    const updatedPayment = await prisma.expressCheckoutPayment.update({
      where: { id: payment.id },
      data: { razorpayOrderId: razorpayOrder.id, rawGatewayPayload: safeJson(razorpayOrder) },
    });
    await prisma.expressCheckoutIntent.updateMany({ where: { shopId: shop.id, id: intent.id }, data: { status: "PAYMENT_PENDING" } });
    console.info("[EXPRESS RAZORPAY] order_create_success", { shopId: shop.id, intentId: intent.id, paymentId: payment.id, reused: false });

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
  } catch (error) {
    await prisma.expressCheckoutPayment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: "Razorpay order creation failed" } });
    console.error("[EXPRESS RAZORPAY] order_create_failed", { shopId: shop.id, intentId: intent.id, paymentId: payment.id, errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : "Unknown error" });
    throw error;
  }
}

export async function verifyExpressCheckoutRazorpayPayment(params: VerifyParams) {
  console.info("[EXPRESS RAZORPAY] verify_start", { intentId: params.intentId, shopDomain: normalizeShopDomain(params.shopDomain), razorpayOrderId: params.razorpay_order_id });

  const shop = await resolveActiveShop(params.shopDomain);
  const intent = await prisma.expressCheckoutIntent.findFirst({ where: { shopId: shop.id, id: params.intentId, ...(params.customerProfileId ? { customerProfileId: params.customerProfileId } : {}) } });
  if (!intent) throw new ExpressCheckoutRazorpayError(404, "Could not verify payment. Please contact support if money was deducted.", "Intent not found");

  const paymentWhere = { shopId: shop.id, intentId: intent.id, method: "PREPAID" as const, razorpayOrderId: params.razorpay_order_id };
  const confirmedPayment = await prisma.expressCheckoutPayment.findFirst({ where: { ...paymentWhere, status: "CONFIRMED", razorpayPaymentId: params.razorpay_payment_id } });
  if (confirmedPayment) {
    console.info("[EXPRESS PREPAID FINALIZATION] payment_confirmed", { shopId: shop.id, intentId: intent.id, paymentId: confirmedPayment.id, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id, idempotent: true });
    try {
      const finalization = await finalizePrepaidExpressCheckoutOrder({ shopId: shop.id, shopDomain: shop.shopDomain, intentId: intent.id, customerProfileId: String(intent.customerProfileId || ""), paymentId: confirmedPayment.id, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id });
      return { ...finalization, intentId: intent.id, paymentId: confirmedPayment.id, status: "ORDER_CREATED", idempotent: true };
    } catch (error) {
      if (error instanceof ExpressCheckoutOrderFinalizationError) throw new ExpressCheckoutRazorpayError(error.status, error.publicMessage, error.message);
      throw error;
    }
  }

  const payment = await prisma.expressCheckoutPayment.findFirst({ where: { ...paymentWhere, status: "PENDING" } });
  if (!payment) throw new ExpressCheckoutRazorpayError(404, "Could not verify payment. Please contact support if money was deducted.", "Pending payment not found");

  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!keySecret) throw new ExpressCheckoutRazorpayError(503, "Could not verify payment. Please contact support if money was deducted.", "Razorpay secret is not configured");

  const expected = crypto.createHmac("sha256", keySecret).update(`${params.razorpay_order_id}|${params.razorpay_payment_id}`).digest("hex");
  const valid = timingSafeSignatureEqual(expected, params.razorpay_signature);

  if (!valid) {
    await prisma.expressCheckoutPayment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: "Invalid Razorpay signature", rawGatewayPayload: safeJson(safePaymentPayload(params, false)) } });
    console.error("[EXPRESS RAZORPAY] verify_failed", { shopId: shop.id, intentId: intent.id, paymentId: payment.id, reason: "invalid_signature" });
    throw new ExpressCheckoutRazorpayError(400, "Could not verify payment. Please contact support if money was deducted.", "Invalid Razorpay signature");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.expressCheckoutPayment.update({
      where: { id: payment.id },
      data: {
        status: "CONFIRMED",
        razorpayPaymentId: params.razorpay_payment_id,
        razorpaySignatureHash: signatureHash(params.razorpay_signature),
        rawGatewayPayload: safeJson(safePaymentPayload(params, true)),
        failureReason: null,
      },
    });
    await tx.expressCheckoutIntent.update({ where: { id: intent.id }, data: { status: "PAYMENT_CONFIRMED" } });
    return updatedPayment;
  });

  console.info("[EXPRESS RAZORPAY] verify_success", { shopId: shop.id, intentId: intent.id, paymentId: updated.id });
  console.info("[EXPRESS PREPAID FINALIZATION] payment_confirmed", { shopId: shop.id, intentId: intent.id, paymentId: updated.id, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id, idempotent: false });

  try {
    const finalization = await finalizePrepaidExpressCheckoutOrder({ shopId: shop.id, shopDomain: shop.shopDomain, intentId: intent.id, customerProfileId: String(intent.customerProfileId || ""), paymentId: updated.id, razorpayOrderId: params.razorpay_order_id, razorpayPaymentId: params.razorpay_payment_id });
    return { ...finalization, intentId: intent.id, paymentId: updated.id, status: "ORDER_CREATED", idempotent: false };
  } catch (error) {
    if (error instanceof ExpressCheckoutOrderFinalizationError) throw new ExpressCheckoutRazorpayError(error.status, error.publicMessage, error.message);
    throw error;
  }
}
