import { NextRequest, NextResponse } from "next/server";
import { listSkuTaxMappings, upsertSkuTaxMapping } from "../../../../../services/gst/sku-tax-map";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../../services/shopify/shop";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const shopDomain = getShopDomainFromRequest(req);
  const shop = await resolveShopConfig(shopDomain);
  const search = req.nextUrl.searchParams.get("search") || undefined;

  const result = await listSkuTaxMappings({
    shopId: shop.id,
    search,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error || "Failed to list SKU mappings" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data || [] });
}

export async function POST(req: NextRequest) {
  const shopDomain = getShopDomainFromRequest(req);
  const shop = await resolveShopConfig(shopDomain);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await upsertSkuTaxMapping({
    shopId: shop.id,
    sku: body.sku ? String(body.sku) : null,
    styleCode: body.styleCode ? String(body.styleCode) : null,
    hsnCode: String(body.hsnCode || ""),
    taxRate: Number(body.taxRate),
    cessRate: body.cessRate == null || body.cessRate === "" ? 0 : Number(body.cessRate),
    source: body.source ? String(body.source) : "MANUAL_UI",
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error || "Failed to upsert SKU mapping" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data }, { status: 201 });
}
