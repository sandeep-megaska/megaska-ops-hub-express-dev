import { NextRequest, NextResponse } from "next/server";
import { getLoopDeskRuntimeConfig } from "../../../../services/loopdesk/runtime-config";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../services/shopify/shop";
import { getStorefrontPromotionRuntime } from "../../../../services/promotions/storefront-runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const shop = await resolveShopConfig(getShopDomainFromRequest(req));
  if (!shop.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });

  const config = await getLoopDeskRuntimeConfig(shop.id);
  const promotions = await getStorefrontPromotionRuntime(shop).catch(() => ({ rules: [] }));
  return NextResponse.json(
    { ok: true, config, promotions, shopDomain: shop.shopDomain },
    { headers: { "Cache-Control": "no-store" } }
  );
}
