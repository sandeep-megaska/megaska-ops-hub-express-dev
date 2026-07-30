import { NextRequest, NextResponse } from "next/server";
import { listImportedOrders } from "../../../../services/gst/order-import";
import { requireAdminShopFromRequest } from "../../../../services/shopify/admin-auth";
import { ShopResolutionError } from "../../../../services/shopify/shop";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  let shop;
  try {
    shop = await requireAdminShopFromRequest(req);
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 401;
    const message = error instanceof ShopResolutionError ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: message }, { status });
  }

  const url = req.nextUrl;
  const result = await listImportedOrders({
    shopId: shop.id,
    gstSettingsId: url.searchParams.get("gstSettingsId") || undefined,
    importStatus: url.searchParams.get("importStatus") || undefined,
    eligibilityStatus: url.searchParams.get("eligibilityStatus") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data ?? [] });
}
