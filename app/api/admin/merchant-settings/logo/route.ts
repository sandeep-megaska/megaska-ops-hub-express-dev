import { NextRequest, NextResponse } from "next/server";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";
import { LOGO_MAX_BYTES, ShopifyFileUploadError, uploadImageToShopifyFiles } from "../../../../../services/shopify/file-upload";

export const runtime = "nodejs";
export const maxDuration = 30;

// Uploads a logo to the store's Shopify Files and returns its cdn.shopify.com URL. The
// shop comes from the verified App Bridge session token, never from the request body.
export async function POST(req: NextRequest) {
  let shop;
  try {
    shop = await requireAdminShopFromRequest(req);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Choose an image to upload." }, { status: 400 });
  if (file.size > LOGO_MAX_BYTES) return NextResponse.json({ ok: false, error: "The image must be 2 MB or smaller." }, { status: 413 });

  try {
    const url = await uploadImageToShopifyFiles(shop.shopDomain, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name || "logo",
      mimeType: file.type,
      alt: "Store logo",
    });
    return NextResponse.json({ ok: true, url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof ShopifyFileUploadError;
    console.error("merchant_logo_upload_failed", { shopId: shop.id, code: known ? error.code : "UNKNOWN", message: error instanceof Error ? error.message : String(error) });
    const scopeMissing = !known && /access denied|write_files|not approved to access/i.test(error instanceof Error ? error.message : "");
    return NextResponse.json(
      { ok: false, error: known ? error.message : scopeMissing ? "LoopD2C needs permission to upload files. Update the app's permissions in Shopify, then try again." : "The upload didn't work. Please try again." },
      { status: known ? 400 : 502 },
    );
  }
}
