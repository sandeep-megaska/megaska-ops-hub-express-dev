import { NextRequest, NextResponse } from "next/server";
import { getLoopDeskRuntimeConfig } from "../../../../services/loopdesk/runtime-config";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../services/shopify/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const shop = await resolveShopConfig(getShopDomainFromRequest(req));
  if (!shop.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });

  const config = await getLoopDeskRuntimeConfig(shop.id, shop.shopDomain, { primaryDomain: shop.primaryDomain, myshopifyDomain: shop.myshopifyDomain });
  console.info("[Runtime Config] projection", {
    shopId: shop.id,
    shopDomain: shop.shopDomain,
    moduleKey: "promotion_rules_config",
    found: Boolean(config.promotion_rules_config?.rules?.length),
    enabled: Boolean(config.promotion_rules_config?.enabled),
    ruleCount: config.promotion_rules_config?.rules?.length || 0,
  });
  return NextResponse.json(
    { ok: true, config, shopDomain: shop.shopDomain },
    { headers: { "Cache-Control": "no-store" } }
  );
}
