import { NextRequest, NextResponse } from "next/server";
import { getLoopDeskRuntimeConfig } from "../../../../services/loopdesk/runtime-config";
import { getShopDomainFromRequest, normalizeShopDomain, resolveShopConfig } from "../../../../services/shopify/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function publicationDebugEnabled() {
  return process.env.LOOPDESK_PUBLICATION_DEBUG === "1" || process.env.LOOPDESK_PUBLICATION_DEBUG === "true";
}

export async function GET(req: NextRequest) {
  const requestedShopDomain = getShopDomainFromRequest(req);
  const shop = await resolveShopConfig(requestedShopDomain);
  if (!shop.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });

  const canonicalShopDomain = normalizeShopDomain(shop.myshopifyDomain || shop.shopDomain);
  const config = await getLoopDeskRuntimeConfig(shop.id, canonicalShopDomain, {
    caller: "storefront_runtime",
    requestedShopDomain,
    normalizedShopDomain: normalizeShopDomain(requestedShopDomain),
    shopDomain: shop.shopDomain,
    myshopifyDomain: shop.myshopifyDomain || null,
    primaryDomain: shop.primaryDomain || null,
    hasAdminAccessToken: Boolean(shop.accessToken),
  });
  const selectedAutomaticDiscountId = (config.promotion_rules_config?.publication as { automaticDiscountId?: string | null } | undefined)?.automaticDiscountId || null;
  console.info("[Runtime Config] projection", {
    shopId: shop.id,
    shopDomain: shop.shopDomain,
    moduleKey: "promotion_rules_config",
    found: Boolean(config.promotion_rules_config?.rules?.length),
    enabled: Boolean(config.promotion_rules_config?.enabled),
    ruleCount: config.promotion_rules_config?.rules?.length || 0,
  });
  return NextResponse.json(
    {
      ok: true,
      config,
      shopDomain: shop.shopDomain,
      ...(publicationDebugEnabled() ? {
        publicationDebug: {
          shopId: shop.id,
          requestedShopDomain,
          resolvedShopDomain: canonicalShopDomain,
          myshopifyDomain: shop.myshopifyDomain || null,
          selectedAutomaticDiscountId,
        },
      } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
