import { NextRequest, NextResponse } from "next/server";
import { getLoopDeskRuntimeConfig } from "../../../../services/loopdesk/runtime-config";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../services/shopify/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const shop = await resolveShopConfig(getShopDomainFromRequest(req));
  if (!shop.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });

  const config = await getLoopDeskRuntimeConfig(shop.id);
  console.info("[Runtime Config API] resolved shop for projection", {
    shopId: shop.id,
    shopDomain: shop.shopDomain,
    promotionRulesFound: Boolean(config.promotion_rules_config?.rules?.length),
    promotionRulesEnabled: Boolean(config.promotion_rules_config?.enabled),
  });
  return NextResponse.json(
    { ok: true, config, shopDomain: shop.shopDomain },
    { headers: { "Cache-Control": "no-store" } }
  );
}
