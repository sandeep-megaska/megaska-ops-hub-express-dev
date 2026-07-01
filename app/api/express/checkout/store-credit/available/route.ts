import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../services/auth/session";
import { requireCustomerSessionForShop, requireExpressCheckoutShop } from "../../../../../../lib/express-checkout/safety";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { getAvailableStoreCreditForCheckout } from "../../../../../../services/express-checkout/store-credit";

export const runtime = "nodejs";
function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) { return withCors(req, NextResponse.json(body, init)); }
export async function OPTIONS(req: NextRequest) { return handleOptions(req); }
export async function GET(req: NextRequest) {
  const shop = await requireExpressCheckoutShop(req); if ("error" in shop) return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });
  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId); if ("error" in auth) return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });
  const checkoutIntentId = String(new URL(req.url).searchParams.get("checkoutIntentId") || "").trim();
  if (!checkoutIntentId) return jsonWithCors(req, { ok: false, error: "checkoutIntentId required" }, { status: 400 });
  try { const result = await getAvailableStoreCreditForCheckout({ shopId: shop.shopId, customerProfileId: auth.customer.id, checkoutIntentId }); return jsonWithCors(req, { ok: true, availableAmount: result.availableAmount, currency: result.currency, appliedAmount: result.appliedAmount, remainingPayable: result.remainingPayable }); }
  catch (error) { console.error("[STORE CREDIT CHECKOUT] store_credit_checkout_failed", { shopId: shop.shopId, checkoutIntentId, error: error instanceof Error ? error.message : "Unknown error" }); return jsonWithCors(req, { ok: false, error: "Unable to load Megaska Store Credit right now." }, { status: 500 }); }
}
