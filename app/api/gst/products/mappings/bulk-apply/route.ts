import { NextRequest, NextResponse } from "next/server";
import { applyBulkProductTaxMappings } from "../../../../../../services/gst/product-tax-bulk";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../../../services/shopify/shop-resolver";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const shopDomain = getShopDomainFromRequest(req);
  const shop = await resolveShopConfig(shopDomain);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, data: null, error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await applyBulkProductTaxMappings(
    Array.isArray(body.rows)
      ? body.rows.map((row) => row as { sku: string; styleCode?: string; hsnCode: string; taxRate?: number; cessRate?: number })
      : [],
    shop.id,
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, data: null, error: result.error || "Failed to apply bulk mapping" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data, error: null });
}
