import test from "node:test";
import assert from "node:assert/strict";

import { resolvePromotionComparePrice } from "./price-resolution.ts";
import { normalizePromotionRule, normalizePromotionRulesConfig, validatePromotionRulesConfig } from "./config.ts";

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

test("fixed_amount reward discount normalizes and serializes correctly", () => {
  const rule = normalizePromotionRule({
    id: "fixed-amount",
    name: "Fixed amount",
    reward: { discount: { type: "fixed_amount", value: 100 } },
    display: { heading: "Offer", ctaLabel: "Add offer" },
  });

  assert.deepEqual(rule.reward.discount, { type: "fixed_amount", value: 100 });
  assert.equal(JSON.parse(JSON.stringify(rule)).reward.discount.type, "fixed_amount");
});


test("active rules accept canonical reward product variant metadata", () => {
  const config = normalizePromotionRulesConfig({
    enabled: true,
    maxVisibleOffers: 1,
    rules: [{
      id: "metadata-variant",
      name: "Metadata variant",
      enabled: true,
      status: "active",
      eligibility: { triggers: [{ type: "always", value: "" }] },
      reward: {
        type: "offer_product",
        productGid: "gid://shopify/Product/1",
        quantity: 1,
        product: {
          gid: "gid://shopify/Product/1",
          title: "Offer",
          variantGid: "gid://shopify/ProductVariant/1",
          variantTitle: "Default Title",
          variantPrice: "450.00",
        },
      },
      display: { heading: "Offer", ctaLabel: "Add offer" },
    }],
  });

  assert.equal(config.rules[0].reward.variantGid, "gid://shopify/ProductVariant/1");
  assert.equal(config.rules[0].reward.product?.variantGid, "gid://shopify/ProductVariant/1");
  assert.deepEqual(validatePromotionRulesConfig(config), []);
});

test("active rules still reject missing offer variant metadata", () => {
  const config = normalizePromotionRulesConfig({
    enabled: true,
    maxVisibleOffers: 1,
    rules: [{
      id: "missing-variant",
      name: "Missing variant",
      enabled: true,
      status: "active",
      eligibility: { triggers: [{ type: "always", value: "" }] },
      reward: { type: "offer_product", productGid: "gid://shopify/Product/1", quantity: 1, product: { gid: "gid://shopify/Product/1", title: "Offer" } },
      display: { heading: "Offer", ctaLabel: "Add offer" },
    }],
  });

  assert.match(validatePromotionRulesConfig(config).join(" "), /selected product and variant/);
});
