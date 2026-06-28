import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../../../_lib/cors";
import { prisma } from "../../../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../../../lib/express-checkout/safety";

export const runtime = "nodejs";

const BLOCKED_STATUSES = ["EXPIRED", "CANCELLED", "FAILED", "ORDER_CREATED"];

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}

function getSessionToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const queryToken = req.nextUrl.searchParams.get("token")?.trim() || "";

  return bearerToken || queryToken;
}

function requiredString(body: Record<string, unknown>, field: string) {
  const value = typeof body[field] === "string" ? body[field].trim() : "";
  return value || null;
}

function verifySignature(orderId: string, paymentId: string, signature: string) {
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();

  if (!keySecret) throw new Error("Razorpay credentials are not configured");

  const expected = crypto.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });

  const auth = await requireCustomerSessionForShop(getSessionToken(req), shop.shopId);

  if ("error" in auth) return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });

  const intentId = String((await context.params).id || "").trim();
  const customerProfileId = String(auth.customer.id || "").trim();

  if (!intentId) return jsonWithCors(req, { ok: false, error: "Intent id required" }, { status: 400 });
  if (!customerProfileId) return jsonWithCors(req, { ok: false, error: "Customer profile required" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) return jsonWithCors(req, { ok: false, error: "Invalid JSON body" }, { status: 400 });

  const razorpayOrderId = requiredString(body, "razorpay_order_id");
  const razorpayPaymentId = requiredString(body, "razorpay_payment_id");
  const razorpaySignature = requiredString(body, "razorpay_signature");

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return jsonWithCors(req, { ok: false, error: "Razorpay payment details are required" }, { status: 400 });
  }

  const intentWhere = { shopId: shop.shopId, id: intentId, customerProfileId };
  const intent = await prisma.expressCheckoutIntent.findFirst({ where: intentWhere });

  if (!intent) return jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 });
  if (BLOCKED_STATUSES.includes(intent.status)) return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot be updated` }, { status: 409 });
  if (intent.expiresAt && intent.expiresAt <= new Date()) return jsonWithCors(req, { ok: false, error: "Intent expired" }, { status: 409 });

  const paymentWhere = { shopId: shop.shopId, intentId, razorpayOrderId, intent: { customerProfileId } };
  const payment = await prisma.expressCheckoutPayment.findFirst({ where: paymentWhere });

  let verified = false;

  try {
    verified = verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  } catch (error) {
    return jsonWithCors(req, { ok: false, error: error instanceof Error ? error.message : "Unable to verify payment" }, { status: 500 });
  }

  if (!verified) {
    if (payment) {
      await prisma.expressCheckoutPayment.updateMany({ where: paymentWhere, data: { status: "FAILED", failureReason: "Invalid Razorpay signature", rawGatewayPayload: JSON.parse(JSON.stringify(body)) } });
    }

    return jsonWithCors(req, { ok: false, error: "Invalid Razorpay signature" }, { status: 400 });
  }

  if (!payment) return jsonWithCors(req, { ok: false, error: "Payment not found" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    await tx.expressCheckoutPayment.updateMany({
      where: paymentWhere,
      data: {
        status: "CONFIRMED",
        razorpayPaymentId,
        razorpaySignatureHash: crypto.createHash("sha256").update(razorpaySignature).digest("hex"),
        rawGatewayPayload: JSON.parse(JSON.stringify(body)),
        failureReason: null,
      },
    });

    await tx.expressCheckoutIntent.updateMany({ where: intentWhere, data: { status: "PAYMENT_CONFIRMED" } });

    const updatedIntent = await tx.expressCheckoutIntent.findFirstOrThrow({ where: intentWhere });
    const updatedPayment = await tx.expressCheckoutPayment.findFirstOrThrow({ where: paymentWhere });

    return { intent: updatedIntent, payment: updatedPayment };
  });

  return jsonWithCors(req, { ok: true, ...result });
}
