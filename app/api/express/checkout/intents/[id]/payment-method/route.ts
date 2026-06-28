import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../services/auth/session";
import { withCors, handleOptions } from "../../../../../_lib/cors";
import { prisma } from "../../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../../lib/express-checkout/safety";
import { getExpressCheckoutSettings } from "../../../../../../../services/express-checkout/settings";

export const runtime = "nodejs";

const BLOCKED_STATUSES = ["EXPIRED", "CANCELLED", "FAILED", "ORDER_CREATED"];
const PAYMENT_METHODS = ["COD", "PREPAID"] as const;

type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}


function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && PAYMENT_METHODS.includes(value as PaymentMethod);
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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) return jsonWithCors(req, { ok: false, error: "Invalid JSON body" }, { status: 400 });
  if (!isPaymentMethod(body.method)) return jsonWithCors(req, { ok: false, error: "method must be COD or PREPAID" }, { status: 400 });

  const intentWhere = { shopId: shop.shopId, id: intentId, customerProfileId };
  const intent = await prisma.expressCheckoutIntent.findFirst({ where: intentWhere });

  if (!intent) return jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 });
  if (BLOCKED_STATUSES.includes(intent.status)) {
    return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot be updated` }, { status: 409 });
  }
  if (intent.expiresAt && intent.expiresAt <= new Date()) return jsonWithCors(req, { ok: false, error: "Intent expired" }, { status: 409 });

  const method = body.method;
  const settings = await getExpressCheckoutSettings(shop.shopId);
  const codFeeAmountPaise = method === "COD" ? settings.codFeeAmountPaise : 0;
  const totalAmountPaise = Math.max(0, intent.subtotalAmountPaise + intent.shippingAmountPaise + codFeeAmountPaise - intent.discountAmountPaise);
  const amountPaise = method === "COD" ? 0 : totalAmountPaise;
  const paymentStatus = method === "COD" ? "NOT_REQUIRED" : "PENDING";

  const result = await prisma.$transaction(async (tx) => {
    await tx.expressCheckoutPayment.deleteMany({ where: { shopId: shop.shopId, intentId, method, status: "PENDING", intent: { customerProfileId } } });

    const payment = await tx.expressCheckoutPayment.create({ data: { shopId: shop.shopId, intentId, method, status: paymentStatus, amountPaise, currency: intent.currency } });

    await tx.expressCheckoutIntent.updateMany({ where: intentWhere, data: { selectedPaymentMethod: method, codFeeAmountPaise, totalAmountPaise, status: "PAYMENT_METHOD_SELECTED" } });
    const updatedIntent = await tx.expressCheckoutIntent.findFirstOrThrow({ where: intentWhere });

    return { intent: updatedIntent, payment };
  });

  return jsonWithCors(req, { ok: true, ...result }, { status: 201 });
}
