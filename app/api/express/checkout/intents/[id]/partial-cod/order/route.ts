import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../../services/auth/session";
import { requireCustomerSessionForShop, requireExpressCheckoutShop } from "../../../../../../../../lib/express-checkout/safety";
import { withCors, handleOptions } from "../../../../../../_lib/cors";
import { finalizePartialCodExpressCheckoutOrder, PartialCodOrderFinalizationError } from "../../../../../../../../services/cod-advance/order-finalization";

export const runtime = "nodejs";
function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) { return withCors(req, NextResponse.json(body, init)); }
export async function OPTIONS(req: NextRequest) { return handleOptions(req); }

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const shop = await requireExpressCheckoutShop(req);
  if ("error" in shop) return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status === 403 ? 401 : shop.status });
  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId);
  if ("error" in auth) return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });
  const checkoutIntentId = String((await context.params).id || "").trim();
  if (!checkoutIntentId) return jsonWithCors(req, { ok: false, code: "CHECKOUT_NOT_ELIGIBLE", error: "Checkout not found." }, { status: 404 });
  try {
    const result = await finalizePartialCodExpressCheckoutOrder({ shopId: shop.shopId, shopDomain: shop.shopDomain, checkoutIntentId, customerProfileId: auth.customer.id });
    return jsonWithCors(req, result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    const status = error instanceof PartialCodOrderFinalizationError ? error.status : 503;
    const code = error instanceof PartialCodOrderFinalizationError ? error.code : "PARTIAL_COD_RECONCILIATION_REQUIRED";
    console.error("[PARTIAL COD] order finalization route failed", { shopId: shop.shopId, checkoutIntentId, code, error: error instanceof Error ? error.message : "unknown" });
    const message = status === 404 ? "Partial COD checkout not found." : status === 409 ? "Your checkout changed after the advance was paid. Please contact support." : "Your advance is secure. We could not confirm the order yet. Please retry.";
    return jsonWithCors(req, { ok: false, code, error: message, message }, { status });
  }
}
