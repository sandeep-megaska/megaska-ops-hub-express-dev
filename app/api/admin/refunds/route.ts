import { NextRequest, NextResponse } from "next/server";
import { requireShopFromRequest, ShopResolutionError } from "../../../../services/shopify/shop";
import { listAdminRefunds } from "../../../../services/refund/admin-refunds";

export async function GET(req: NextRequest) {
  try {
    const shop = await requireShopFromRequest(req);
    const data = await listAdminRefunds(shop.id);
    return NextResponse.json({ refunds: data });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
