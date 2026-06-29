import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../services/auth/session";
import { requireCustomerSessionForShop, requireExpressCheckoutShop } from "../../../../../../../lib/express-checkout/safety";
import { withCors, handleOptions } from "../../../../../_lib/cors";
import { ExpressCheckoutRazorpayError, verifyExpressCheckoutRazorpayPayment } from "../../../../../../../services/express-checkout/razorpay";

export const runtime = "nodejs";

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}

function requiredString(body: Record<string, unknown>, field: string) {
  const value = typeof body[field] === "string" ? body[field].trim() : "";
  return value || null;
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
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const razorpay_order_id = body ? requiredString(body, "razorpay_order_id") : null;
  const razorpay_payment_id = body ? requiredString(body, "razorpay_payment_id") : null;
  const razorpay_signature = body ? requiredString(body, "razorpay_signature") : null;

  if (!intentId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return jsonWithCors(req, { ok: false, error: "Could not verify payment. Please contact support if money was deducted." }, { status: 400 });
  }

  try {
    const result = await verifyExpressCheckoutRazorpayPayment({ shopDomain: shop.shopDomain, intentId, customerProfileId: auth.customer.id, razorpay_order_id, razorpay_payment_id, razorpay_signature });
    return jsonWithCors(req, result);
  } catch (error) {
    const status = error instanceof ExpressCheckoutRazorpayError ? error.status : 500;
    const publicMessage = error instanceof ExpressCheckoutRazorpayError ? error.publicMessage : "Could not verify payment. Please contact support if money was deducted.";
    console.error("[EXPRESS RAZORPAY] verify_failed", { shopId: shop.shopId, intentId, razorpayOrderId: razorpay_order_id, errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : "Unknown error" });
    return jsonWithCors(req, { ok: false, error: publicMessage }, { status });
  }
}
