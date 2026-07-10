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

test("active product-scoped rules accept missing offer variant metadata", () => {
  const config = normalizePromotionRulesConfig({
    enabled: true,
    maxVisibleOffers: 1,
    rules: [{
      id: "missing-variant",
      name: "Missing variant",
      enabled: true,
      status: "active",
      eligibility: { triggers: [{ type: "always", value: "" }] },
      reward: { type: "offer_product", productGid: "gid://shopify/Product/1", variantSelectionMode: "product", scope: "product", quantity: 1, product: { gid: "gid://shopify/Product/1", title: "Offer" } },
      display: { heading: "Offer", ctaLabel: "Add offer" },
    }],
  });

  assert.deepEqual(validatePromotionRulesConfig(config), []);
  assert.equal(config.rules[0].reward.variantGid, "");
});


test("product-scoped rewards clear stale variant metadata", () => {
  const rule = normalizePromotionRule({
    id: "product-scope",
    name: "Product scope",
    reward: {
      type: "offer_product",
      productGid: "gid://shopify/Product/1",
      variantGid: "gid://shopify/ProductVariant/stale",
      variantSelectionMode: "product",
      scope: "product",
      product: {
        gid: "gid://shopify/Product/1",
        title: "Offer",
        variantGid: "gid://shopify/ProductVariant/stale",
        variantTitle: "Stale",
        variantPrice: "999.00",
        variantCompareAtPrice: "1299.00",
      },
    },
  });

  assert.equal(rule.reward.variantSelectionMode, "product");
  assert.equal(rule.reward.scope, "product");
  assert.equal(rule.reward.variantGid, "");
  assert.equal(rule.reward.product?.variantGid, "");
  assert.equal(rule.reward.product?.variantTitle, "");
  assert.equal(rule.reward.product?.variantPrice, "");
  assert.equal(rule.reward.product?.variantCompareAtPrice, "");
});

test("active variant-scoped rules require an explicit offer variant", () => {
  const config = normalizePromotionRulesConfig({
    enabled: true,
    maxVisibleOffers: 1,
    rules: [{
      id: "missing-variant",
      name: "Missing variant",
      enabled: true,
      status: "active",
      eligibility: { triggers: [{ type: "always", value: "" }] },
      reward: { type: "offer_product", productGid: "gid://shopify/Product/1", variantSelectionMode: "variant", scope: "variant", quantity: 1, product: { gid: "gid://shopify/Product/1", title: "Offer" } },
      display: { heading: "Offer", ctaLabel: "Add offer" },
    }],
  });

  assert.match(validatePromotionRulesConfig(config).join(" "), /Rule \"Missing variant\": variant-specific rewards require a selected variant\./);
});
