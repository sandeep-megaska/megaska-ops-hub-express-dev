import test from "node:test";
import assert from "node:assert/strict";

import { resolvePromotionComparePrice } from "./price-resolution.ts";

test("compare price resolves from selected offer variant Shopify price before admin fallback", () => {
  const rule = {
    reward: {
      type: "offer_product",
      productGid: "gid://shopify/Product/1",
      variantGid: "gid://shopify/ProductVariant/1",
      quantity: 1,
      product: {
        gid: "gid://shopify/Product/1",
        title: "Offer",
        variantGid: "gid://shopify/ProductVariant/1",
        variantPrice: "₹450",
      },
    },
    display: { offerPriceDisplay: "₹150", comparePriceDisplay: "₹999" },
  };

  assert.equal(rule.display.offerPriceDisplay, "₹150");
  assert.deepEqual(resolvePromotionComparePrice(rule), { value: "₹450", source: "shopify_variant_price" });
});

test("legacy compare price remains fallback when Shopify variant price is unavailable", () => {
  const rule = {
    reward: { type: "offer_product", productGid: "gid://shopify/Product/1", variantGid: "gid://shopify/ProductVariant/1", quantity: 1 },
    display: { offerPriceDisplay: "₹150", comparePriceDisplay: "₹450" },
  };

  assert.deepEqual(resolvePromotionComparePrice(rule), { value: "₹450", source: "legacy_compare_price" });
});

test("compare price is unavailable when neither variant price nor legacy fallback exists", () => {
  const rule = {
    reward: { type: "offer_product", productGid: "gid://shopify/Product/1", variantGid: "gid://shopify/ProductVariant/1", quantity: 1 },
    display: { offerPriceDisplay: "₹150" },
  };

  assert.deepEqual(resolvePromotionComparePrice(rule), { value: "", source: "unavailable" });
});
