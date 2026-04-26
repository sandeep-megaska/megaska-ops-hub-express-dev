import { NextRequest, NextResponse } from "next/server";
import { recomputeImportedOrderMappings } from "../../../../../../services/gst/order-import";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../../../services/shopify/shop-resolver";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const shopDomain = getShopDomainFromRequest(req);
  const shop = await resolveShopConfig(shopDomain);

  const result = await recomputeImportedOrderMappings({ shopId: shop.id });
  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error || "Failed to recompute order readiness" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data }, { status: 200 });
}
