import { NextRequest, NextResponse } from "next/server";
import { requireShopFromRequest, ShopResolutionError } from "../../../../../../services/shopify/shop";
import { approveAdminRefund } from "../../../../../../services/refund/admin-refunds";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireShopFromRequest(req);
    const { id } = await context.params;
    const result = await approveAdminRefund(shop.id, id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
