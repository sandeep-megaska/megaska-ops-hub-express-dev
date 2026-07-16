import { NextRequest, NextResponse } from "next/server";
import { getMerchantBillingOverview } from "../../../../../services/billing/merchant-billing-overview";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
export async function GET(req: NextRequest) {
  const resolved = await resolveAdminShopFromRequest(req);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(resolved) }, { status: 401, headers });
  try { return NextResponse.json({ ok: true, overview: await getMerchantBillingOverview({ shopId: resolved.shop.id }) }, { headers }); }
  catch (error) { console.error("billing_overview_load_failed", { shopId: resolved.shop.id, error: error instanceof Error ? error.name : "unknown" }); return NextResponse.json({ ok: false, error: "Unable to load billing overview" }, { status: 500, headers }); }
}
