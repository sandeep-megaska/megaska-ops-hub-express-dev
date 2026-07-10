export type * from "./types";
export { AjaxCartPricingSource } from "./ajax-cart-source";
export { StorefrontCartPricingSource } from "./storefront-cart-source";
export { normalizeAjaxCartPricing, logPricingDiagnostics, AJAX_CART_CAPABILITIES, STOREFRONT_CART_CAPABILITIES } from "./normalize";

import { AjaxCartPricingSource } from "./ajax-cart-source";
import type { ShopifyPricingSource } from "./types";

export function selectShopifyPricingSource(): ShopifyPricingSource {
  return new AjaxCartPricingSource();
}
