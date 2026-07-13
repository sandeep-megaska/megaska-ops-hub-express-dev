import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../../../services/auth/session";
import { requireCustomerSessionForShop, requireExpressCheckoutShop } from "../../../../../../../../../lib/express-checkout/safety";
import { withCors, handleOptions } from "../../../../../../../_lib/cors";
import { CodAdvanceRazorpayVerifyError, verifyCodAdvanceRazorpayPayment } from "../../../../../../../../../services/cod-advance/razorpay-verify";

export const runtime = "nodejs";
function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) { return withCors(req, NextResponse.json(body, init)); }
function requiredString(body: Record<string, unknown>, field: string) { const value = typeof body[field] === "string" ? body[field].trim() : ""; return value || null; }
export async function OPTIONS(req: NextRequest) { return handleOptions(req); }

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const shop = await requireExpressCheckoutShop(req);
  if ("error" in shop) return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status === 403 ? 401 : shop.status });
  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId);
  if ("error" in auth) return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });
  const checkoutIntentId = String((await context.params).id || "").trim();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const razorpayOrderId = body ? requiredString(body, "razorpay_order_id") : null;
  const razorpayPaymentId = body ? requiredString(body, "razorpay_payment_id") : null;
  const razorpaySignature = body ? requiredString(body, "razorpay_signature") : null;
  if (!checkoutIntentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) return jsonWithCors(req, { ok: false, code: "MALFORMED_BODY", error: "Could not verify COD advance payment. Please retry or contact support if money was deducted." }, { status: 400 });
  try {
    const result = await verifyCodAdvanceRazorpayPayment({ shopId: shop.shopId, shopDomain: shop.shopDomain, checkoutIntentId, customerProfileId: auth.customer.id, razorpayOrderId, razorpayPaymentId, razorpaySignature });
    return jsonWithCors(req, { ok: true, ...result }, { status: 200 });
  } catch (error) {
    const status = error instanceof CodAdvanceRazorpayVerifyError ? error.status : 503;
    const code = error instanceof CodAdvanceRazorpayVerifyError ? error.code : "COD_ADVANCE_VERIFICATION_FAILED";
    const message = status === 404 ? "COD advance checkout not found." : status === 502 || status === 503 ? "Payment was verified by Razorpay but needs reconciliation. Please contact support if this persists." : "Could not verify COD advance payment. Please retry or contact support if money was deducted.";
    console.error("[COD ADVANCE] razorpay verify route failed", { shopId: shop.shopId, checkoutIntentId, razorpayOrderId, razorpayPaymentId, code, error: error instanceof Error ? error.message : "unknown" });
    return jsonWithCors(req, { ok: false, code, error: message, message }, { status });
  }
}
