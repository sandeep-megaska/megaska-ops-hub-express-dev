import { NextRequest, NextResponse } from "next/server";
import { exportUnmappedSkuMappingsCsv } from "../../../../../../services/gst/sku-tax-map";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../../../services/shopify/shop-resolver";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const shopDomain = getShopDomainFromRequest(req);
  const shop = await resolveShopConfig(shopDomain);
  const result = await exportUnmappedSkuMappingsCsv(shop.id);

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error || "Failed to export unmapped SKUs" }, { status: 400 });
  }

  return new NextResponse(result.data, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gst-unmapped-skus-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
