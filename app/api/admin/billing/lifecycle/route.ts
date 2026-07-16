import { NextRequest, NextResponse } from "next/server";
import { getBillingLifecycleStatus } from "../../../../../services/billing/lifecycle";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operational read endpoint: the shop is resolved from the authenticated admin context, never request body. */
export async function GET(req: NextRequest) {
  const resolved = await resolveAdminShopFromRequest(req);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(resolved) }, { status: 401, headers: { "Cache-Control": "no-store, private" } });
  const lifecycle = await getBillingLifecycleStatus({ shopId: resolved.shop.id });
  return NextResponse.json({ ok: true, lifecycle }, { headers: { "Cache-Control": "no-store, private" } });
}
