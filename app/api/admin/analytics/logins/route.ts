import { NextRequest, NextResponse } from "next/server";
import {
  resolveAdminShopFromRequest,
  formatAdminShopResolutionError,
} from "../../../../../services/shopify/admin-shop-context";
import { resolveReviewAnalyticsRange } from "../../../../../services/reviews/review-analytics-date-range";
import { getLoginAnalytics } from "../../../../../services/analytics/login-analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const context = await resolveAdminShopFromRequest(req);
  if (!context.shop?.id) {
    return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(context) }, { status: 401 });
  }
  try {
    const range = resolveReviewAnalyticsRange(req.nextUrl.searchParams);
    const logins = await getLoginAnalytics(context.shop.id, range);
    return NextResponse.json({ ok: true, ...logins }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid analytics request." },
      { status: 400 },
    );
  }
}
