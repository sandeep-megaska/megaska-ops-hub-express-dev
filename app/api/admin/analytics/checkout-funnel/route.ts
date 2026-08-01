import { NextRequest, NextResponse } from "next/server";
import {
  resolveAdminShopFromRequest,
  formatAdminShopResolutionError,
} from "../../../../../services/shopify/admin-shop-context";
import { resolveReviewAnalyticsRange } from "../../../../../services/reviews/review-analytics-date-range";
import { getCheckoutFunnel, getPaymentMix } from "../../../../../services/analytics/checkout-funnel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const context = await resolveAdminShopFromRequest(req);
  if (!context.shop?.id) {
    return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(context) }, { status: 401 });
  }
  try {
    const range = resolveReviewAnalyticsRange(req.nextUrl.searchParams);
    const [funnel, paymentMix] = await Promise.all([
      getCheckoutFunnel(context.shop.id, range),
      getPaymentMix(context.shop.id, range),
    ]);
    return NextResponse.json({ ok: true, funnel, paymentMix }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid analytics request." },
      { status: 400 },
    );
  }
}
