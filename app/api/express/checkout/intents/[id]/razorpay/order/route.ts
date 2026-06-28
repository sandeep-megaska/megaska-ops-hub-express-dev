import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../../../_lib/cors";
import { prisma } from "../../../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../../../lib/express-checkout/safety";

export const runtime = "nodejs";

const BLOCKED_STATUSES = ["EXPIRED", "CANCELLED", "FAILED", "ORDER_CREATED"];

type RazorpayOrder = { id: string; amount: number; currency: string; receipt?: string; status?: string } & Record<string, unknown>;

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}

function getSessionToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const queryToken = req.nextUrl.searchParams.get("token")?.trim() || "";

  return bearerToken || queryToken;
}

async function createRazorpayOrder(amountPaise: number, currency: string, receipt: string): Promise<RazorpayOrder> {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();

  if (!keyId || !keySecret) throw new Error("Razorpay credentials are not configured");

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: amountPaise, currency, receipt }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.id) throw new Error(typeof payload?.error?.description === "string" ? payload.error.description : "Unable to create Razorpay order");

  return payload as RazorpayOrder;
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

  const intentWhere = { shopId: shop.shopId, id: intentId, customerProfileId };
  const intent = await prisma.expressCheckoutIntent.findFirst({ where: intentWhere });

  if (!intent) return jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 });
  if (BLOCKED_STATUSES.includes(intent.status)) return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot be updated` }, { status: 409 });
  if (intent.expiresAt && intent.expiresAt <= new Date()) return jsonWithCors(req, { ok: false, error: "Intent expired" }, { status: 409 });
  if (intent.selectedPaymentMethod !== "PREPAID") return jsonWithCors(req, { ok: false, error: "PREPAID payment method required" }, { status: 409 });
  if (intent.totalAmountPaise <= 0) return jsonWithCors(req, { ok: false, error: "Payment amount must be greater than 0" }, { status: 400 });

  let razorpayOrder: RazorpayOrder;

  try {
    razorpayOrder = await createRazorpayOrder(intent.totalAmountPaise, intent.currency, `ec_${intent.id.slice(0, 32)}`);
  } catch (error) {
    return jsonWithCors(req, { ok: false, error: error instanceof Error ? error.message : "Unable to create Razorpay order" }, { status: 502 });
  }

  const result = await prisma.$transaction(async (tx) => {
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

  return jsonWithCors(req, { ok: true, ...result, razorpayOrder: { id: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency, receipt: razorpayOrder.receipt, status: razorpayOrder.status, keyId: process.env.RAZORPAY_KEY_ID } }, { status: 201 });
}
