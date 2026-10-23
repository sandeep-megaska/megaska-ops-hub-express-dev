import { NextRequest, NextResponse } from "next/server";
import { importSkuMappingsCsv } from "../../../../../../services/gst/sku-tax-map";
import { resolveShopConfig } from "../../../../../../services/shopify/shop";
import { resolveGstAdminShopDomain } from "../../../../../../services/gst/request-shop";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const shopDomain = await resolveGstAdminShopDomain(req);
  if (!shopDomain) return NextResponse.json({ ok: false, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });
  const shop = await resolveShopConfig(shopDomain);

  let csvText = "";
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file");
    if (file instanceof File) {
      csvText = await file.text();
    }
  }

  if (!csvText) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    csvText = String(body?.csvText || "").trim();
  }

  if (!csvText) {
    return NextResponse.json({ ok: false, error: "csvText or file is required" }, { status: 400 });
  }

  const result = await importSkuMappingsCsv(csvText, shop.id);
  if (!result.ok || !result.data) {
    const errorMessage = "error" in result ? result.error : undefined;
    return NextResponse.json({ ok: false, error: errorMessage || "Failed to import sku mappings" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, ...result.data, applied: result.data.imported }, { status: 200 });
}
