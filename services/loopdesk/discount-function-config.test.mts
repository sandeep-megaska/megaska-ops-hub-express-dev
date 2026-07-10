import test from "node:test";
import assert from "node:assert/strict";

import { normalizePromotionRule } from "../promotion-rules/config.ts";
import { compilePromotionRuleEnforcementRule } from "./discount-function-config.server.ts";

test("fixed_price enforcement uses reward discount value and ignores display price", () => {
  const rule = normalizePromotionRule({
    id: "display-price-ignored",
    name: "Display price ignored",
    enabled: true,
    priority: 1,
    status: "active",
    reward: {
      type: "offer_product",
      productGid: "gid://shopify/Product/1",
      variantGid: "gid://shopify/ProductVariant/1",
      quantity: 1,
      discount: { type: "fixed_price", value: 125 },
    },
    display: {
      heading: "Offer",
      ctaLabel: "Add offer",
      offerPriceDisplay: "₹999 merchant display copy",
    },
  });

  const compiled = compilePromotionRuleEnforcementRule(rule);

  assert.equal(compiled?.rewardEnforcementType, "fixed_price");
  assert.equal(compiled?.fixedPriceAmount, 125);
});

test("display price alone does not create fixed_price enforcement", () => {
  const rule = normalizePromotionRule({
    id: "display-price-only",
    name: "Display price only",
    enabled: true,
    priority: 1,
    status: "active",
    reward: {
      type: "offer_product",
      productGid: "gid://shopify/Product/1",
      variantGid: "gid://shopify/ProductVariant/1",
      quantity: 1,
    },
    display: {
      heading: "Offer",
      ctaLabel: "Add offer",
      offerPriceDisplay: "₹125",
    },
  });

  assert.equal(compilePromotionRuleEnforcementRule(rule)?.triggerType, "cart_contains_product");
});

test("percentage enforcement compiles valid reward discount values", () => {
  const rule = normalizePromotionRule({
    id: "percentage-reward",
    name: "Percentage reward",
    enabled: true,
    priority: 1,
    status: "active",
    reward: {
      type: "offer_product",
      productGid: "gid://shopify/Product/1",
      variantGid: "gid://shopify/ProductVariant/1",
      quantity: 2,
      discount: { type: "percentage", value: 25 },
    },
    display: { heading: "Offer", ctaLabel: "Add offer" },
  });

  const compiled = compilePromotionRuleEnforcementRule(rule);

  assert.equal(compiled?.rewardEnforcementType, "percentage");
  assert.equal(compiled?.percentageValue, 25);
  assert.equal(compiled?.quantity, 2);
});

test("fixed_amount enforcement compiles valid reward discount values", () => {
  const rule = normalizePromotionRule({
    id: "fixed-amount-reward",
    name: "Fixed amount reward",
    enabled: true,
    priority: 1,
    status: "active",
    reward: {
      type: "offer_product",
      productGid: "gid://shopify/Product/1",
      variantGid: "gid://shopify/ProductVariant/1",
      quantity: 2,
      discount: { type: "fixed_amount", value: 100 },
    },
    display: { heading: "Offer", ctaLabel: "Add offer" },
  });

  const compiled = compilePromotionRuleEnforcementRule(rule);

  assert.equal(compiled?.rewardEnforcementType, "fixed_amount");
  assert.equal(compiled?.fixedAmountValue, 100);
  assert.equal(compiled?.quantity, 2);
});

test("invalid fixed_amount reward values are ignored", () => {
  const rule = normalizePromotionRule({
    id: "invalid-fixed-amount",
    name: "Invalid fixed amount",
    reward: { discount: { type: "fixed_amount", value: 0 } },
    display: { heading: "Offer", ctaLabel: "Add offer" },
  });

  assert.equal(rule.reward.discount, undefined);
  assert.equal(compilePromotionRuleEnforcementRule(rule), null);
});

test("canonicalizes numeric ProductVariant ids and rejects malformed ids", async () => {
  const mod = await import("./discount-function-config.server.ts");
  assert.equal(mod.canonicalizeProductVariantGid("123"), "gid://shopify/ProductVariant/123");
  assert.equal(mod.canonicalizeProductVariantGid("gid://shopify/ProductVariant/456"), "gid://shopify/ProductVariant/456");
  assert.throws(() => mod.canonicalizeProductVariantGid("gid://shopify/Product/123"), /Malformed Shopify ProductVariant ID/);
});

test("compiler supports product trigger instead of skipping it", () => {
  const rule = normalizePromotionRule({
    id: "product-trigger-supported",
    name: "Unsupported trigger",
    enabled: true,
    priority: 1,
    status: "active",
    eligibility: { triggers: [{ type: "cart_contains_product", productGid: "gid://shopify/Product/1", value: "gid://shopify/Product/1" }] },
    reward: { productGid: "gid://shopify/Product/1", variantGid: "gid://shopify/ProductVariant/1", discount: { type: "fixed_price", value: 300 } },
    display: { heading: "Offer", ctaLabel: "Add offer" },
  });

  assert.equal(compilePromotionRuleEnforcementRule(rule)?.triggerType, "cart_contains_product");
});

test("current snowboard rule compiles to fixed_price 300 quantity 1 canonical variant GID and supported trigger", () => {
  const rule = normalizePromotionRule({
    id: "snowboard-300",
    name: "Snowboard ₹300",
    enabled: true,
    priority: 1,
    status: "active",
    eligibility: { triggers: [{ type: "cart_contains_variant", variantGid: "1234567890", value: "1234567890" }] },
    reward: {
      type: "offer_product",
      productGid: "gid://shopify/Product/987654321",
      variantGid: "1234567890",
      quantity: 1,
      discount: { type: "fixed_price", value: 300 },
    },
    display: { heading: "Snowboard offer", ctaLabel: "Add offer" },
  });

  const compiled = compilePromotionRuleEnforcementRule(rule);

  assert.equal(compiled?.rewardEnforcementType, "fixed_price");
  assert.equal(compiled?.fixedPriceAmount, 300);
  assert.equal(compiled?.quantity, 1);
  assert.equal(compiled?.rewardVariantGid, "gid://shopify/ProductVariant/1234567890");
  assert.equal(compiled?.triggerType, "cart_contains_variant");
  assert.equal(compiled?.triggerValue, "gid://shopify/ProductVariant/1234567890");
});

test("compiler emits disabled empty config shape when no executable active rules exist", () => {
  const compiled = [
    normalizePromotionRule({ id: "draft", enabled: true, status: "draft", reward: { variantGid: "gid://shopify/ProductVariant/1", discount: { type: "fixed_price", value: 300 } }, display: { heading: "Offer", ctaLabel: "Add offer" } }),
  ].filter((rule) => rule.enabled && rule.status === "active").map(compilePromotionRuleEnforcementRule).filter(Boolean);

  assert.deepEqual({ schemaVersion: 1, enabled: compiled.length > 0, rules: compiled }, { schemaVersion: 1, enabled: false, rules: [] });
});

test("canonicalizes Product ids and rejects malformed Product ids", async () => {
  const mod = await import("./discount-function-config.server.ts");
  assert.equal(mod.canonicalizeProductGid("123"), "gid://shopify/Product/123");
  assert.equal(mod.canonicalizeProductGid("gid://shopify/Product/456"), "gid://shopify/Product/456");
  assert.throws(() => mod.canonicalizeProductGid("gid://shopify/ProductVariant/123"), /Malformed Shopify Product ID/);
});

test("cart_contains_product compiles with canonical Product GID", () => {
  const rule = normalizePromotionRule({
    id: "product-trigger",
    enabled: true,
    priority: 1,
    status: "active",
    eligibility: { triggers: [{ type: "cart_contains_product", productGid: "123", value: "123" }] },
    reward: { productGid: "456", variantGid: "gid://shopify/ProductVariant/1", discount: { type: "fixed_price", value: 300 } },
    display: { heading: "Offer", ctaLabel: "Add offer" },
  });
  const compiled = compilePromotionRuleEnforcementRule(rule);
  assert.equal(compiled?.triggerType, "cart_contains_product");
  assert.equal(compiled?.triggerValue, "gid://shopify/Product/123");
  assert.equal(compiled?.rewardProductGid, "gid://shopify/Product/456");
});

test("product reward compiles without rewardVariantGid when explicitly scoped to product", () => {
  const rule = normalizePromotionRule({
    id: "product-reward",
    enabled: true,
    priority: 1,
    status: "active",
    reward: { productGid: "gid://shopify/Product/1", variantGid: "gid://shopify/ProductVariant/1", variantSelectionMode: "product", discount: { type: "percentage", value: 10 } },
    display: { heading: "Offer", ctaLabel: "Add offer" },
  });
  const compiled = compilePromotionRuleEnforcementRule(rule);
  assert.equal(compiled?.rewardSelectionMode, "product");
  assert.equal(compiled?.rewardProductGid, "gid://shopify/Product/1");
  assert.equal(compiled?.rewardVariantGid, null);
});

test("legacy reward with variant GID and no mode remains variant scoped", () => {
  const rule = normalizePromotionRule({
    id: "legacy-variant",
    enabled: true,
    priority: 1,
    status: "active",
    reward: { productGid: "gid://shopify/Product/1", variantGid: "2", discount: { type: "percentage", value: 10 } },
    display: { heading: "Offer", ctaLabel: "Add offer" },
  });
  const compiled = compilePromotionRuleEnforcementRule(rule);
  assert.equal(compiled?.rewardSelectionMode, "variant");
  assert.equal(compiled?.rewardVariantGid, "gid://shopify/ProductVariant/2");
});

test("product-level compiled rule is valid without rewardVariantGid", async () => {
  const mod = await import("./discount-function-config.server.ts");
  assert.equal(mod.isValidCompiledRule({
    id: "product-valid",
    enabled: true,
    priority: 1,
    triggerType: "always",
    rewardSelectionMode: "product",
    rewardProductGid: "gid://shopify/Product/1",
    rewardVariantGid: null,
    rewardEnforcementType: "fixed_price",
    fixedPriceAmount: 200,
  }), true);
});

test("unsupported collection product-type and tag triggers remain excluded", () => {
  for (const trigger of [
    { type: "cart_contains_collection", collectionGid: "gid://shopify/Collection/1", value: "gid://shopify/Collection/1" },
    { type: "cart_contains_product_type", productType: "Hat", value: "Hat" },
    { type: "cart_contains_tag", tag: "vip", value: "vip" },
  ]) {
    const rule = normalizePromotionRule({
      id: `unsupported-${trigger.type}`,
      enabled: true,
      priority: 1,
      status: "active",
      eligibility: { triggers: [trigger] },
      reward: { productGid: "gid://shopify/Product/1", variantGid: "gid://shopify/ProductVariant/1", discount: { type: "fixed_price", value: 300 } },
      display: { heading: "Offer", ctaLabel: "Add offer" },
    });
    assert.equal(compilePromotionRuleEnforcementRule(rule), null);
  }
});
