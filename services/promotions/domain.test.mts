import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProductType, normalizeRewardValue, normalizeShopifyCollectionGid, normalizeShopifyProductGid } from "./normalization.ts";
import { validatePromotionRule, validatePromotionTriggerReference } from "./validation.ts";

test("canonicalizes Shopify Product and Collection GIDs", () => {
  assert.equal(normalizeShopifyProductGid(" 123 "), "gid://shopify/Product/123");
  assert.equal(normalizeShopifyProductGid("gid://shopify/Product/456"), "gid://shopify/Product/456");
  assert.equal(normalizeShopifyProductGid("gid://shopify/ProductVariant/456"), null);
  assert.equal(normalizeShopifyCollectionGid("789"), "gid://shopify/Collection/789");
});

test("normalizes product types with Unicode compatibility and case folding", () => {
  assert.equal(normalizeProductType("  Ｓｗｉｍｗｅａｒ  "), "swimwear");
  assert.equal(normalizeProductType("   "), null);
});

test("normalizes numeric reward values without inferring reward semantics", () => {
  assert.equal(normalizeRewardValue(50), 50);
  assert.equal(normalizeRewardValue("50"), 50);
  assert.equal(normalizeRewardValue({ toString: () => "50" }), 50);
  assert.equal(normalizeRewardValue({ toString: () => "12.5000" }), 12.5);
  assert.equal(normalizeRewardValue(" 40.50 "), 40.5);
  assert.equal(normalizeRewardValue(""), null);
  assert.equal(normalizeRewardValue("not-money"), null);
  assert.equal(normalizeRewardValue(Number.NaN), null);
  assert.equal(normalizeRewardValue(Infinity), null);
  assert.equal(normalizeRewardValue("-Infinity"), null);
  assert.equal(normalizeRewardValue({}), null);
  assert.equal(normalizeRewardValue({ toString: () => { throw new Error("boom"); } }), null);
});

test("validates trigger reference shape by trigger type", () => {
  assert.equal(validatePromotionTriggerReference({ sourceType: "PRODUCT", referenceGid: "gid://shopify/Product/123" }).valid, true);
  assert.equal(validatePromotionTriggerReference({ sourceType: "PRODUCT", referenceGid: "gid://shopify/ProductVariant/123" }).valid, false);
  assert.equal(validatePromotionTriggerReference({ sourceType: "COLLECTION", referenceGid: "gid://shopify/Collection/123" }).valid, true);
  // Product-type triggers are rejected: the discount Function runtime is GID-based
  // and cannot fulfil them, so they must never reach the compile/publish path.
  assert.equal(validatePromotionTriggerReference({ sourceType: "PRODUCT_TYPE", referenceValue: "Swimwear", normalizedValue: "swimwear" }).valid, false);
  assert.equal(validatePromotionTriggerReference({ sourceType: "PRODUCT_TYPE", referenceValue: " ", normalizedValue: "" }).valid, false);
});

test("validates promotion rule quantities, schedule, rewards, and presentation limits", () => {
  const result = validatePromotionRule({
    name: "Shoes sock offer",
    status: "ACTIVE",
    triggerType: "COLLECTION",
    triggerReferences: [{ sourceType: "COLLECTION", referenceGid: "gid://shopify/Collection/456" }],
    minimumTriggerQuantity: 1,
    offerProductGid: "gid://shopify/Product/123",
    rewardType: "PERCENTAGE_OFF",
    rewardValue: "40",
    maximumRewardQuantity: 1,
    startsAt: "2026-07-11T00:00:00.000Z",
    endsAt: "2026-07-12T00:00:00.000Z",
    heading: "Recommended add-on",
  });
  assert.deepEqual(result, { valid: true, errors: [] });

  const invalid = validatePromotionRule({
    name: " ",
    status: "ACTIVE",
    triggerType: "PRODUCT",
    triggerReferences: [{ sourceType: "COLLECTION", referenceGid: "gid://shopify/Collection/456" }],
    minimumTriggerQuantity: 0,
    offerProductGid: "gid://shopify/ProductVariant/123",
    rewardType: "PERCENTAGE_OFF",
    rewardValue: 101,
    maximumRewardQuantity: 0,
    startsAt: "2026-07-12T00:00:00.000Z",
    endsAt: "2026-07-12T00:00:00.000Z",
    badgeText: "x".repeat(61),
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.field === "name"));
  assert.ok(invalid.errors.some((error) => error.field === "rewardValue"));
  assert.ok(invalid.errors.some((error) => error.field === "triggerReferences.0.sourceType"));
});

test("validates fixed reward types independently", () => {
  const base = {
    name: "Fixed offer",
    triggerType: "PRODUCT" as const,
    triggerReferences: [{ sourceType: "PRODUCT" as const, referenceGid: "gid://shopify/Product/123" }],
    minimumTriggerQuantity: 1,
    offerProductGid: "gid://shopify/Product/456",
    maximumRewardQuantity: 1,
  };
  assert.equal(validatePromotionRule({ ...base, rewardType: "PERCENTAGE_OFF", rewardValue: { toString: () => "50" } as never }).valid, true);
  assert.equal(validatePromotionRule({ ...base, rewardType: "PERCENTAGE_OFF", rewardValue: { toString: () => "150" } as never }).valid, false);
  assert.equal(validatePromotionRule({ ...base, rewardType: "FIXED_AMOUNT_OFF", rewardValue: 0 }).valid, false);
  assert.equal(validatePromotionRule({ ...base, rewardType: "FIXED_AMOUNT_OFF", rewardValue: { toString: () => "100" } as never }).valid, true);
  assert.equal(validatePromotionRule({ ...base, rewardType: "FIXED_PRICE", rewardValue: 0 }).valid, true);
  assert.equal(validatePromotionRule({ ...base, rewardType: "FIXED_PRICE", rewardValue: { toString: () => "0" } as never }).valid, true);
  assert.equal(validatePromotionRule({ ...base, rewardType: "FIXED_PRICE", rewardValue: -1 }).valid, false);
});
