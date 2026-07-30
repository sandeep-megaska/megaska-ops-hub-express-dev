import { NextRequest, NextResponse } from "next/server";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";
import { buildReviewExportCsv } from "../../../../../services/reviews/review-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/reviews/export?shop=<domain>[&status=published,pending][&includeDeleted=true]
// Streams the shop's reviews as the canonical Megaska review CSV. Tenant-scoped
// via resolveAdminShopFromRequest; a foreign/unresolved shop fails closed (401).
export async function GET(req: NextRequest) {
  const context = await resolveAdminShopFromRequest(req);
  if (!context.shop?.id) {
    return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(context) }, { status: 401 });
  }

  try {
    const params = req.nextUrl.searchParams;
    const includeDeleted = params.get("includeDeleted") === "true";
    const statusParam = (params.get("status") || "").trim();
    const statuses = statusParam
      ? statusParam.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean)
      : undefined;

    const { csv, rowCount } = await buildReviewExportCsv(context.shop.id, { statuses, includeDeleted });
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="megaska-reviews-${stamp}.csv"`,
        "X-Review-Export-Row-Count": String(rowCount),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to export reviews." },
      { status: 500 },
    );
  }
}
