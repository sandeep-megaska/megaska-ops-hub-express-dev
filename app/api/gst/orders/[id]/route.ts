import { NextRequest, NextResponse } from "next/server";
import { getImportedOrderDetail } from "../../../../../services/gst/order-import";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const params = await context.params;
    const result = await getImportedOrderDetail(params.id, { shopId: shop.id });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    if (!result.data) {
      return NextResponse.json({ ok: false, error: "Imported order not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: result.data });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
