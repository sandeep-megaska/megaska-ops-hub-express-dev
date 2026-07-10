import type { ShopifyPricingSource, ShopifyPricingSourceReadParams } from "./types";
import { logPricingDiagnostics, normalizeAjaxCartPricing } from "./normalize";

export class AjaxCartPricingSource implements ShopifyPricingSource {
  readonly sourceType = "ajax-cart" as const;

  async readPricing(params: ShopifyPricingSourceReadParams = {}) {
    const rawCart = params.ajaxCart ?? await this.fetchAjaxCart(params);
    const model = normalizeAjaxCartPricing(rawCart);
    logPricingDiagnostics(model, params.debug);
    return model;
  }

  private async fetchAjaxCart(params: ShopifyPricingSourceReadParams) {
    const fetchImpl = params.fetchImpl || fetch;
    const shopDomain = String(params.shopDomain || "").trim();
    const url = shopDomain ? `https://${shopDomain.replace(/^https?:\/\//, "")}/cart.js` : "/cart.js";
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Shopify Ajax cart read failed (${response.status})`);
    return response.json();
  }
}
