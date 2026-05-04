import { NextRequest, NextResponse } from "next/server";
import { requireShopFromRequest, ShopResolutionError } from "../../../../../services/shopify/shop";
import { getAdminRefundById } from "../../../../../services/refund/admin-refunds";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireShopFromRequest(req);
    const { id } = await context.params;
    const data = await getAdminRefundById(shop.id, id);
    if (!data) return NextResponse.json({ error: "Refund not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
