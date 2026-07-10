import { NextRequest, NextResponse } from "next/server";
import { getLoopDeskRuntimeConfig } from "../../../../services/loopdesk/runtime-config";
import { canonicalPublicationShopDomain, getShopDomainFromRequest, resolveShopConfig } from "../../../../services/shopify/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const shop = await resolveShopConfig(getShopDomainFromRequest(req));
  if (!shop.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });

  const canonicalShopDomain = canonicalPublicationShopDomain(shop);
  const config = await getLoopDeskRuntimeConfig(shop.id, canonicalShopDomain);
  console.info("[Runtime Config] projection", {
    shopId: shop.id,
    shopDomain: shop.shopDomain,
    moduleKey: "promotion_rules_config",
    found: Boolean(config.promotion_rules_config?.rules?.length),
    enabled: Boolean(config.promotion_rules_config?.enabled),
    ruleCount: config.promotion_rules_config?.rules?.length || 0,
  });
  const debug = process.env.LOOPDESK_PUBLICATION_DEBUG
    ? {
        shopId: shop.id,
        rawShopDomain: shop.shopDomain,
        myshopifyDomain: shop.myshopifyDomain,
        primaryDomain: shop.primaryDomain,
        canonicalShopDomain,
        selectedAutomaticDiscountId: "automaticDiscountId" in config.promotion_rules_config.publication ? config.promotion_rules_config.publication.automaticDiscountId : null,
      }
    : undefined;
  return NextResponse.json(
    { ok: true, config, shopDomain: shop.shopDomain, ...(debug ? { publicationDebug: debug } : {}) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
