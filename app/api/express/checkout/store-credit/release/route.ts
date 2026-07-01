import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../services/auth/session";
import { requireCustomerSessionForShop, requireExpressCheckoutShop } from "../../../../../../lib/express-checkout/safety";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { releaseStoreCreditReservation } from "../../../../../../services/express-checkout/store-credit";
export const runtime = "nodejs";
function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) { return withCors(req, NextResponse.json(body, init)); }
export async function OPTIONS(req: NextRequest) { return handleOptions(req); }
export async function POST(req: NextRequest) {
  const shop = await requireExpressCheckoutShop(req); if ("error" in shop) return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });
  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId); if ("error" in auth) return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null) as { checkoutIntentId?: string } | null; const checkoutIntentId = String(body?.checkoutIntentId || "").trim();
  if (!checkoutIntentId) return jsonWithCors(req, { ok: false, error: "checkoutIntentId required" }, { status: 400 });
  const result = await releaseStoreCreditReservation({ shopId: shop.shopId, customerProfileId: auth.customer.id, checkoutIntentId, reason: "customer-removed-store-credit" });
  return jsonWithCors(req, { ok: true, released: result.released, remainingPayable: result.remainingPayable, currency: result.currency });
}
