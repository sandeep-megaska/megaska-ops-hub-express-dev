import { NextRequest, NextResponse } from "next/server";
import { getMerchantBillingHistory } from "../../../../../services/billing/billing-dashboard.service";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET(req: NextRequest) {
  const startedAt = Date.now(); const resolved = await resolveAdminShopFromRequest(req);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(resolved) }, { status: 401, headers });
  const cursor = req.nextUrl.searchParams.get("cursor") || undefined;
  try {
    const history = await getMerchantBillingHistory({ shopId: resolved.shop.id, cursor, limit: 10 });
    console.info("billing_history_loaded", { shopId: resolved.shop.id, result: "success", duration: Date.now() - startedAt });
    return NextResponse.json({ ok: true, history }, { headers });
  } catch {
    console.error("billing_history_load_failed", { shopId: resolved.shop.id, result: "failed", duration: Date.now() - startedAt });
    return NextResponse.json({ ok: false, error: "Unable to load billing history" }, { status: 500, headers });
  }
}
