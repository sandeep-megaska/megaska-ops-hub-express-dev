import { NextRequest, NextResponse } from "next/server";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../../services/shopify/admin-shop-context";
import { overview } from "../../../../../../services/reviews/review-analytics";
import { resolveReviewAnalyticsRange } from "../../../../../../services/reviews/review-analytics-date-range";
const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
export async function GET(req: NextRequest) {
  const context = await resolveAdminShopFromRequest(req);
  if (!context.shop?.id) return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(context) }, { status: 401 });
  try {
    if ((req.nextUrl.searchParams.get("report") || "review-summary") !== "review-summary") return NextResponse.json({ ok: false, error: "Unsupported export report." }, { status: 400 });
    const data = await overview(context.shop.id, resolveReviewAnalyticsRange(req.nextUrl.searchParams));
    const row = data.reviewVolumeSeries[0];
    const csv = [["bucket_start", "reviews_submitted", "reviews_published", "reviews_rejected"], [data.range.start, row.submitted, row.published, row.rejected]].map((values) => values.map(escape).join(",")).join("\r\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="review-summary-${data.range.start.slice(0, 10)}-${data.range.end.slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ ok: false, error: "Invalid analytics export range." }, { status: 400 }); }
}
