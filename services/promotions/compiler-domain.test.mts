import test from "node:test";
import assert from "node:assert/strict";

import { compilePromotionRule } from "./compiler-payload.ts";
import { canonicalDecimalString, canonicalUtcIso, canonicalProductGid } from "./compiler-normalization.ts";
import type { PromotionCompilerRuleInput } from "./compiler-domain.ts";

class DecimalLike { value: string; constructor(value: string) { this.value = value; } toString() { return this.value; } }

const base = (overrides: Partial<PromotionCompilerRuleInput> = {}): PromotionCompilerRuleInput => ({
  id: "rule-1", shopId: "shop-1", status: "ACTIVE", priority: 10, triggerType: "PRODUCT", triggerMatchMode: "ANY", minimumTriggerQuantity: 1, minimumCartSubtotal: "50.00",
  triggerReferences: [{ id: "ref-b", sourceType: "PRODUCT", referenceGid: "gid://shopify/Product/200" }, { id: "ref-a", sourceType: "PRODUCT", referenceGid: "gid://shopify/Product/100" }],
  offerProductGid: "gid://shopify/Product/999", offerProductTitle: "Offer", offerProductHandle: "offer", offerProductImageUrl: "https://cdn.example/offer.jpg",
  rewardType: "PERCENTAGE_OFF", rewardValue: "12.5000", maximumRewardQuantity: 2, startsAt: "2026-07-11T10:00:00-05:00", endsAt: "2026-07-12T15:00:00.000Z",
  combinesWithProductDiscounts: true, combinesWithOrderDiscounts: false, combinesWithShippingDiscounts: true,
  heading: "Buy more", badgeText: "Deal", customerMessage: "Add eligible items", ctaText: "Shop", description: "Internal only", createdAt: new Date(), updatedAt: new Date(), adminToken: "secret", ...overrides,
});

test("Product-trigger source-group generation, multiple triggers, and deduplicated flattened set", () => {
  const result = compilePromotionRule(base({ triggerReferences: [{ id: "one", sourceType: "PRODUCT", referenceGid: "100" }, { id: "two", sourceType: "PRODUCT", referenceGid: "100" }, { id: "three", sourceType: "PRODUCT", referenceGid: "200" }] }));
  assert.equal(result.sourceSnapshot.trigger.sourceGroups.length, 3);
  assert.deepEqual(result.sourceSnapshot.trigger.sourceGroups.map((g) => g.sourceReferenceId), ["one", "three", "two"]);
  assert.deepEqual(result.diagnostics.flattenedProductGids, ["gid://shopify/Product/100", "gid://shopify/Product/200"]);
});

test("stable source and product ordering produce equal hashes", () => {
  const a = compilePromotionRule(base());
  const b = compilePromotionRule(base({ triggerReferences: [...base().triggerReferences].reverse(), minimumCartSubtotal: 50, rewardValue: new DecimalLike("12.50") }));
  assert.equal(a.hashes.sourceHash, b.hashes.sourceHash);
  assert.deepEqual(a.sourceSnapshot.trigger.sourceGroups.map((g) => g.productGids), [["gid://shopify/Product/100"], ["gid://shopify/Product/200"]]);
});

test("order compiler ignores legacy product reward columns and compiles persisted tiers", () => {
  const result = compilePromotionRule(base({ rewardScope: "ORDER", rewardType: "" as never, rewardValue: Number.NaN, offerProductGid: "", tierContinuityMode: "CONTINUOUS", orderTiers: [{ publicId: "tier-1", minimumSubtotal: "0", maximumSubtotal: "100", percentage: "5", position: 0 }, { publicId: "tier-2", minimumSubtotal: "100", percentage: "10", position: 1 }] }));
  assert.equal(result.sourceSnapshot.reward.scope, "order");
  if (result.sourceSnapshot.reward.scope !== "order") assert.fail("expected order reward");
  assert.deepEqual(result.sourceSnapshot.reward.configuration.tiers.map((tier) => tier.percentage), ["5", "10"]);
});

test("ANY and ALL match modes preserve source groups", () => {
  assert.equal(compilePromotionRule(base({ triggerMatchMode: "ANY" })).functionPayload.trigger.sourceGroups.length, 2);
  const all = compilePromotionRule(base({ triggerMatchMode: "ALL" }));
  assert.equal(all.functionPayload.trigger.matchMode, "ALL");
  assert.equal(all.functionPayload.trigger.sourceGroups.length, 2);
});

test("decimal normalization handles numbers, strings, Decimal-like objects, and rejects invalid values", () => {
  assert.equal(canonicalDecimalString(50), "50");
  assert.equal(canonicalDecimalString("50.00"), "50");
  assert.equal(canonicalDecimalString(new DecimalLike("12.5000")), "12.5");
  assert.equal(canonicalDecimalString(0), "0");
  assert.throws(() => canonicalDecimalString(Number.NaN));
  assert.throws(() => canonicalDecimalString(Infinity));
  assert.throws(() => canonicalDecimalString("abc"));
});

test("UTC date normalization converts valid dates to ISO strings", () => {
  assert.equal(canonicalUtcIso("2026-07-11T10:00:00-05:00"), "2026-07-11T15:00:00.000Z");
});

test("ProductVariant GIDs are rejected", () => {
  assert.throws(() => canonicalProductGid("gid://shopify/ProductVariant/123"), /ProductVariant/);
  assert.throws(() => compilePromotionRule(base({ offerProductGid: "gid://shopify/ProductVariant/999" })), /ProductVariant/);
});

test("different execution inputs change source hash", () => {
  assert.notEqual(compilePromotionRule(base()).hashes.sourceHash, compilePromotionRule(base({ priority: 11 })).hashes.sourceHash);
});

test("presentation-only changes affect storefront hash but not Function hash", () => {
  const a = compilePromotionRule(base({ heading: "A", offerProductTitle: "A" }));
  const b = compilePromotionRule(base({ heading: "B", offerProductTitle: "B" }));
  assert.equal(a.hashes.functionHash, b.hashes.functionHash);
  assert.notEqual(a.hashes.storefrontHash, b.hashes.storefrontHash);
});

test("display snapshots and presentation are excluded from Function payload", () => {
  const payload = compilePromotionRule(base()).functionPayload as unknown as Record<string, unknown>;
  assert.equal(JSON.stringify(payload).includes("Offer"), false);
  assert.equal(JSON.stringify(payload).includes("Buy more"), false);
  assert.equal("presentation" in payload, false);
});

test("internal description, secrets, and Admin tokens are excluded from payloads and hashes", () => {
  const result = compilePromotionRule(base({ description: "Sensitive", adminToken: "shpat_secret" }));
  const serialized = JSON.stringify([result.sourceSnapshot, result.storefrontPayload, result.functionPayload]);
  assert.equal(serialized.includes("Sensitive"), false);
  assert.equal(serialized.includes("shpat_secret"), false);
});

test("payload schema version is 1", () => {
  const result = compilePromotionRule(base());
  assert.equal(result.sourceSnapshot.schemaVersion, 1);
  assert.equal(result.storefrontPayload.schemaVersion, 1);
  assert.equal(result.functionPayload.schemaVersion, 1);
});

test("collection and product-type triggers compile as unresolved source groups", () => {
  const collection = compilePromotionRule(base({ triggerType: "COLLECTION", triggerReferences: [{ id: "c1", sourceType: "COLLECTION", referenceGid: "gid://shopify/Collection/7" }] }));
  assert.equal(collection.sourceSnapshot.trigger.sourceGroups[0].unresolved, true);
  assert.deepEqual(collection.sourceSnapshot.trigger.sourceGroups[0].productGids, []);
  const type = compilePromotionRule(base({ triggerType: "PRODUCT_TYPE", triggerReferences: [{ id: "pt", sourceType: "PRODUCT_TYPE", referenceValue: " Swimwear ", normalizedValue: "Swimwear" }] }));
  assert.equal(type.sourceSnapshot.trigger.sourceGroups[0].sourceValue, "swimwear");
});
