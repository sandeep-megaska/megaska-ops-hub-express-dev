import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../../services/auth/session";
import { requireCustomerSessionForShop, requireExpressCheckoutShop } from "../../../../../../../../lib/express-checkout/safety";
import { withCors, handleOptions } from "../../../../../../_lib/cors";
import { createExpressCheckoutRazorpayOrder, ExpressCheckoutRazorpayError } from "../../../../../../../../services/express-checkout/razorpay";

export const runtime = "nodejs";

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
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
  if (!intentId) return jsonWithCors(req, { ok: false, stage: "RAZORPAY_ORDER_CREATE", code: "INVALID_INTENT_ID", message: "Could not start secure payment. Please try again.", error: "Could not start secure payment. Please try again." }, { status: 400 });

  try {
    const checkout = await createExpressCheckoutRazorpayOrder({ shopDomain: shop.shopDomain, intentId, customerProfileId: auth.customer.id });
    return jsonWithCors(req, { ok: true, checkout, razorpayOrder: { id: checkout.razorpayOrderId, amount: checkout.amountPaise, currency: checkout.currency, keyId: checkout.key } }, { status: 201 });
  } catch (error) {
    const status = error instanceof ExpressCheckoutRazorpayError ? error.status : 500;
    const publicMessage = error instanceof ExpressCheckoutRazorpayError ? error.publicMessage : "Could not start secure payment. Please try again.";
    const stage = error instanceof ExpressCheckoutRazorpayError ? error.stage : "RAZORPAY_ORDER_CREATE";
    const code = error instanceof ExpressCheckoutRazorpayError ? error.code : "RAZORPAY_ORDER_CREATE_FAILED";
    console.error("[EXPRESS RAZORPAY] order_create_failed", { shopId: shop.shopId, intentId, errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : "Unknown error", stage, code });
    return jsonWithCors(req, { ok: false, stage, code, message: publicMessage, error: publicMessage }, { status });
  }
}
