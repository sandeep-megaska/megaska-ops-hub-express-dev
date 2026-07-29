import { NextRequest, NextResponse } from "next/server";
import { getGstInvoiceById } from "../../../../../services/gst/invoice";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const params = await context.params;
    const result = await getGstInvoiceById(params.id, { shopId: shop.id });

    if (!result.ok || !result.data) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
    }

    const invoice = result.data;
    return NextResponse.json({ ok: true, invoice });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
