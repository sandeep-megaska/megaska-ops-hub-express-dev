import { NextRequest, NextResponse } from "next/server";
import {
  resolveAdminShopFromRequest,
  formatAdminShopResolutionError,
} from "../../../../../services/shopify/admin-shop-context";
import { resolveReviewAnalyticsRange } from "../../../../../services/reviews/review-analytics-date-range";
import { getAbandonedCarts, getRecoverySummary } from "../../../../../services/analytics/abandoned-carts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const context = await resolveAdminShopFromRequest(req);
  if (!context.shop?.id) {
    return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(context) }, { status: 401 });
  }
  try {
    const range = resolveReviewAnalyticsRange(req.nextUrl.searchParams);
    const limit = Number(req.nextUrl.searchParams.get("limit") || "100");
    const [carts, recovery] = await Promise.all([
      getAbandonedCarts(context.shop.id, range, Number.isFinite(limit) ? limit : 100),
      getRecoverySummary(context.shop.id, range),
    ]);
    return NextResponse.json({ ok: true, ...carts, recovery }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid analytics request." },
      { status: 400 },
    );
  }
}
