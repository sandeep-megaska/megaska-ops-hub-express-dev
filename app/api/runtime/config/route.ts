import { NextRequest, NextResponse } from "next/server";
import { getLoopDeskRuntimeConfig } from "../../../../services/loopdesk/runtime-config";
import { getExpressCheckoutSettings } from "../../../../services/express-checkout/settings";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../services/shopify/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const shop = await resolveShopConfig(getShopDomainFromRequest(req));
  if (!shop.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });

  const [config, expressSettings] = await Promise.all([
    getLoopDeskRuntimeConfig(shop.id),
    getExpressCheckoutSettings(shop.id),
  ]);

  // Public, non-sensitive summary of the prepaid discount offer so storefront
  // surfaces (cart drawer nudge, product-page badge) can advertise it without
  // an authenticated checkout intent. Only exposed when the offer is enabled.
  const prepaid = expressSettings.prepaidDiscount;
  const prepaidOffer = prepaid.enabled
    ? {
        enabled: true,
        type: prepaid.type,
        value: prepaid.value,
        // Convenience for storefront copy: the percent for a PERCENTAGE offer.
        percent: prepaid.type === "PERCENTAGE" ? prepaid.value : null,
        maxPaise: prepaid.maxPaise,
        minSubtotalPaise: prepaid.minSubtotalPaise,
        // Merchant-customized teaser (supports {percent}/{amount}/{cap}); null = default.
        message: prepaid.offerMessage,
      }
    : null;

  return NextResponse.json(
    { ok: true, config: { ...config, prepaidOffer }, shopDomain: shop.shopDomain },
    { headers: { "Cache-Control": "no-store" } }
  );
}
