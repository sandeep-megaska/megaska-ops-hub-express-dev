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

  assert.equal(compilePromotionRuleEnforcementRule(rule), null);
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
