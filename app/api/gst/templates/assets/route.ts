import { NextRequest, NextResponse } from "next/server";
import { resolveGstAdminShop } from "../../../../../services/gst/request-shop";
import { LOGO_MAX_BYTES, ShopifyFileUploadError, uploadImageToShopifyFiles } from "../../../../../services/shopify/file-upload";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_SLOTS = new Set(["header", "footer"]);

// Uploads a GST invoice logo to the store's own Shopify Files and returns its
// cdn.shopify.com URL. The shop comes from the verified session token.
export async function POST(req: NextRequest) {
  const shop = await resolveGstAdminShop(req);
  if (!shop) return NextResponse.json({ ok: false, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });
  const formData = await req.formData().catch(() => null);
  const slot = String(formData?.get("slot") || "").trim().toLowerCase();
  const file = formData?.get("file");

  if (!ALLOWED_SLOTS.has(slot)) return NextResponse.json({ ok: false, error: "slot must be header or footer" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Choose an image to upload." }, { status: 400 });
  if (file.size > LOGO_MAX_BYTES) return NextResponse.json({ ok: false, error: "The image must be 2 MB or smaller." }, { status: 413 });

  try {
    const url = await uploadImageToShopifyFiles(shop.shopDomain, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name || `invoice-${slot}-logo`,
      mimeType: file.type,
      alt: `Invoice ${slot} logo`,
    });
    return NextResponse.json({ ok: true, url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof ShopifyFileUploadError;
    console.error("gst_logo_upload_failed", { shopId: shop.id, slot, code: known ? error.code : "UNKNOWN", message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false, error: known ? error.message : "The upload didn't work. Please try again." }, { status: known ? 400 : 502 });
  }
}
