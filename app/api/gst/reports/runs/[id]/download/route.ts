import { NextRequest, NextResponse } from "next/server";
import { downloadReportFile } from "../../../../../../../services/gst/report-export";
import { ShopResolutionError } from "../../../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../../../services/shopify/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const result = await downloadReportFile(id, { shopId: shop.id });

    if (!result.ok || !result.data) {
      return NextResponse.json({ ok: false, error: result.error || "Failed to load report file" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, ...result.data });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
