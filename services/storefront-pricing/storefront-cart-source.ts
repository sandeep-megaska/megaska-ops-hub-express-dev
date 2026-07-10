import type { ShopifyPricingReadModel, ShopifyPricingSource, ShopifyPricingSourceReadParams } from "./types";

export class StorefrontCartPricingSource implements ShopifyPricingSource {
  readonly sourceType = "storefront-cart" as const;

  async readPricing(_params: ShopifyPricingSourceReadParams = {}): Promise<ShopifyPricingReadModel> {
    throw new Error("Storefront Cart pricing source is documented but not selected yet; repository evidence does not expose a usable cart identity flow for drawer pricing.");
  }
}
