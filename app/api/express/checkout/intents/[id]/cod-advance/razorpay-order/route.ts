import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../../services/auth/session";
import { requireCustomerSessionForShop, requireExpressCheckoutShop } from "../../../../../../../../lib/express-checkout/safety";
import { withCors, handleOptions } from "../../../../../../_lib/cors";
import { CodAdvanceRazorpayOrderError, createCodAdvanceRazorpayOrder } from "../../../../../../../../services/cod-advance/razorpay-order";

export const runtime = "nodejs";

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) { return withCors(req, NextResponse.json(body, init)); }
export async function OPTIONS(req: NextRequest) { return handleOptions(req); }

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const shop = await requireExpressCheckoutShop(req);
  if ("error" in shop) return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status === 403 ? 401 : shop.status });
  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId);
  if ("error" in auth) return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });
  const checkoutIntentId = String((await context.params).id || "").trim();
  if (!checkoutIntentId) return jsonWithCors(req, { ok: false, error: "Intent id required" }, { status: 404 });
  try {
    const result = await createCodAdvanceRazorpayOrder({ shopId: shop.shopId, shopDomain: shop.shopDomain, checkoutIntentId, customerProfileId: auth.customer.id });
    return jsonWithCors(req, { ok: true, ...result }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    const status = error instanceof CodAdvanceRazorpayOrderError ? error.status : 503;
    const code = error instanceof CodAdvanceRazorpayOrderError ? error.code : "RAZORPAY_ORDER_CREATION_FAILED";
    const message = status === 404 ? "COD advance checkout not found." : status === 409 ? "COD advance payment cannot be started for this checkout." : "Could not start COD advance payment. Please try again.";
    console.error("[COD ADVANCE] razorpay order route failed", { shopId: shop.shopId, checkoutIntentId, code, error: error instanceof Error ? error.message : "unknown" });
    return jsonWithCors(req, { ok: false, code, error: message, message }, { status });
  }
}
