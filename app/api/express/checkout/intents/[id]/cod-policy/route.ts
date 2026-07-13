import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../services/auth/session";
import { withCors, handleOptions } from "../../../../../_lib/cors";
import { requireCustomerSessionForShop, requireExpressCheckoutShop } from "../../../../../../../lib/express-checkout/safety";
import { CodPolicyResolverError, resolveExpressCheckoutCodPolicy } from "../../../../../../../services/cod-advance/resolver";

export const runtime = "nodejs";

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const shop = await requireExpressCheckoutShop(req);
  if ("error" in shop) return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });

  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId);
  if ("error" in auth) return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });

  const checkoutIntentId = String((await context.params).id || "").trim();
  const customerProfileId = String(auth.customer.id || "").trim();

  if (!checkoutIntentId) return jsonWithCors(req, { ok: false, error: "Intent id required" }, { status: 400 });
  if (!customerProfileId) return jsonWithCors(req, { ok: false, error: "Customer profile required" }, { status: 401 });

  try {
    const cod = await resolveExpressCheckoutCodPolicy({ shopId: shop.shopId, shopDomain: shop.shopDomain, checkoutIntentId, customerProfileId });
    return jsonWithCors(req, { ok: true, cod });
  } catch (error) {
    if (error instanceof CodPolicyResolverError) {
      return jsonWithCors(req, { ok: false, error: error.message }, { status: error.status });
    }
    console.error("[COD ADVANCE] cod policy route failed", { shopId: shop.shopId, checkoutIntentId, error: error instanceof Error ? error.message : "unknown" });
    return jsonWithCors(req, { ok: false, error: "Unable to resolve COD policy" }, { status: 500 });
  }
}
