import { NextRequest, NextResponse } from "next/server";
import { ShopResolutionError } from "../../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../../services/shopify/admin-auth";
import { approveAdminRefund } from "../../../../../../services/refund/admin-refunds";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const result = await approveAdminRefund(shop.id, id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
