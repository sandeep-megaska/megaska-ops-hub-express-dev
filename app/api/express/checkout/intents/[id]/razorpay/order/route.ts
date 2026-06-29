import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../../services/auth/session";
import { withCors, handleOptions } from "../../../../../../_lib/cors";
import { prisma } from "../../../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../../../lib/express-checkout/safety";

export const runtime = "nodejs";

const BLOCKED_STATUSES = ["EXPIRED", "CANCELLED", "FAILED", "ORDER_CREATED"];

type RazorpayOrder = { id: string; amount: number; currency: string; receipt?: string; status?: string } & Record<string, unknown>;
type JsonRecord = Record<string, unknown>;

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}


function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
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

function razorpayDiagnostic(input: { shopId: string; intentId: string; customerProfileId: string; intent: { selectedPaymentMethod?: unknown; cartSnapshot?: unknown; subtotalAmountPaise?: number; discountAmountPaise?: number; shippingAmountPaise?: number; codFeeAmountPaise?: number; totalAmountPaise?: number; currency?: string } }) {
  return {
    shopId: input.shopId,
    intentId: input.intentId,
    customerProfileId: input.customerProfileId,
    selectedPaymentMethod: input.intent.selectedPaymentMethod || null,
    lineItemCount: cartLineItemCount(input.intent.cartSnapshot),
    hasAddressSnapshot: false,
    subtotalAmountPaise: input.intent.subtotalAmountPaise ?? null,
    discountAmountPaise: input.intent.discountAmountPaise ?? null,
    shippingAmountPaise: input.intent.shippingAmountPaise ?? null,
    codFeeAmountPaise: input.intent.codFeeAmountPaise ?? null,
    totalAmountPaise: input.intent.totalAmountPaise ?? null,
    currency: input.intent.currency || null,
  };
}

async function createRazorpayOrder(amountPaise: number, currency: string, receipt: string): Promise<RazorpayOrder> {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();

  if (!keyId || !keySecret) {
    const error = new Error("Online payment is temporarily unavailable.");
    error.name = "RazorpayConfigError";
    throw error;
  }

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: amountPaise, currency, receipt }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.id) {
    const error = new Error(typeof payload?.error?.description === "string" ? payload.error.description : "Unable to create Razorpay order");
    error.name = "RazorpayOrderError";
    throw error;
  }

  return payload as RazorpayOrder;
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });

  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId);

  if ("error" in auth) return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });

  const intentId = String((await context.params).id || "").trim();
  const customerProfileId = String(auth.customer.id || "").trim();

  if (!intentId) return jsonWithCors(req, { ok: false, error: "Intent id required" }, { status: 400 });
  if (!customerProfileId) return jsonWithCors(req, { ok: false, error: "Customer profile required" }, { status: 401 });

  const intentWhere = { shopId: shop.shopId, id: intentId, customerProfileId };
  const intent = await prisma.expressCheckoutIntent.findFirst({ where: intentWhere });

  if (!intent) return jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 });
  if (BLOCKED_STATUSES.includes(intent.status)) return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot be updated` }, { status: 409 });
  if (intent.expiresAt && intent.expiresAt <= new Date()) return jsonWithCors(req, { ok: false, error: "Intent expired" }, { status: 409 });
  if (intent.selectedPaymentMethod !== "PREPAID") return jsonWithCors(req, { ok: false, error: "PREPAID payment method required" }, { status: 409 });
  if (!Number.isFinite(intent.totalAmountPaise) || intent.totalAmountPaise <= 0) return jsonWithCors(req, { ok: false, error: "Payment amount must be greater than 0" }, { status: 400 });

  const diagnostic = razorpayDiagnostic({ shopId: shop.shopId, intentId, customerProfileId, intent });
  console.info("[EXPRESS CHECKOUT RAZORPAY] creating order", diagnostic);

  let razorpayOrder: RazorpayOrder;

  try {
    razorpayOrder = await createRazorpayOrder(intent.totalAmountPaise, intent.currency, `ec_${intent.id.slice(0, 32)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create Razorpay order";
    const name = error instanceof Error ? error.name : "UnknownError";
    const razorpayError = asRecord(asRecord(error)?.error);
    console.error("[EXPRESS CHECKOUT RAZORPAY] gateway order failed", { ...diagnostic, errorName: name, errorMessage: message, razorpayErrorCode: razorpayError?.code, razorpayErrorMessage: razorpayError?.description || razorpayError?.reason });
    return jsonWithCors(req, { ok: false, error: name === "RazorpayConfigError" ? "Online payment is temporarily unavailable." : "Unable to create Razorpay order.", reason: name === "RazorpayConfigError" ? undefined : message }, { status: 502 });
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    await tx.expressCheckoutPayment.deleteMany({ where: { shopId: shop.shopId, intentId, method: "PREPAID", status: "PENDING", intent: { customerProfileId } } });

    const payment = await tx.expressCheckoutPayment.create({
      data: {
        shopId: shop.shopId,
        intentId,
        method: "PREPAID",
        status: "PENDING",
        amountPaise: intent.totalAmountPaise,
        currency: intent.currency,
        razorpayOrderId: razorpayOrder.id,
        rawGatewayPayload: JSON.parse(JSON.stringify(razorpayOrder)),
      },
    });

    await tx.expressCheckoutIntent.updateMany({ where: intentWhere, data: { status: "PAYMENT_PENDING" } });
    const updatedIntent = await tx.expressCheckoutIntent.findFirstOrThrow({ where: intentWhere });

      return { intent: updatedIntent, payment };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to persist Razorpay order";
    const name = error instanceof Error ? error.name : "UnknownError";
    console.error("[EXPRESS CHECKOUT RAZORPAY] persistence failed", { ...diagnostic, errorName: name, errorMessage: message });
    return jsonWithCors(req, { ok: false, error: message }, { status: 502 });
  }

  return jsonWithCors(req, { ok: true, ...result, razorpayOrder: { id: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency, receipt: razorpayOrder.receipt, status: razorpayOrder.status, keyId: process.env.RAZORPAY_KEY_ID } }, { status: 201 });
}
