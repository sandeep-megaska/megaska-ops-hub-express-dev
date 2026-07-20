import assert from "node:assert/strict";
import test from "node:test";
import { normalizePromotionReward, productRewardStrategy, resolvePromotionRewardStrategy } from "./reward-strategy.ts";

const defaults = { productGid: "gid://shopify/Product/999", quantityCap: 2 };

for (const [type, method, value] of [
  ["PERCENTAGE_OFF", "percentage", 20],
  ["FIXED_AMOUNT_OFF", "fixed_amount", 200],
  ["FIXED_PRICE", "fixed_price", 499],
] as const) test(`normalizes legacy ${method} product reward`, () => {
  const result = normalizePromotionReward({ type, value, maximumQuantity: 2 }, defaults);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.reward, { scope: "product", method, configuration: { value: String(value), productGid: defaults.productGid, quantityCap: 2 } });
});

test("canonical product reward passes through in normalized form", () => {
  const result = normalizePromotionReward({ scope: "product", method: "percentage", configuration: { value: "20.00", productGid: defaults.productGid, quantityCap: 1 } });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.reward.configuration.value, "20");
});

test("unsupported scope and malformed rewards fail closed with structured diagnostics", () => {
  const unsupported = normalizePromotionReward({ scope: "order", method: "percentage", configuration: { value: 10, productGid: defaults.productGid, quantityCap: 1 } });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.issues[0].code, "unsupported_scope");
  const malformed = normalizePromotionReward({ type: "PERCENTAGE_OFF", value: 101, maximumQuantity: 0 }, defaults);
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.deepEqual(malformed.issues.map((entry) => entry.code), ["invalid_percentage", "invalid_quantity_cap"]);
});

test("missing or malformed explicit variant cannot become executable", () => {
  const malformed = normalizePromotionReward({ scope: "product", method: "percentage", configuration: { value: 10, productGid: defaults.productGid, variantGid: "variant-1", quantityCap: 1 } });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.issues[0].code, "invalid_variant_gid");
});

test("registry selects only product strategy and evaluation retains cap and diagnostic states", () => {
  const result = normalizePromotionReward({ type: "FIXED_AMOUNT_OFF", value: 50, maximumQuantity: 2 }, defaults);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(resolvePromotionRewardStrategy(result.reward), productRewardStrategy);
  assert.deepEqual(productRewardStrategy.evaluate(result.reward as never, { eligible: true, eligibleQuantity: 5 }), { applicable: true, scope: "product", method: "fixed_amount", targetProductGid: defaults.productGid, eligibleQuantity: 2, configuredValue: 50 });
  assert.equal(productRewardStrategy.evaluate(result.reward as never, { eligible: true, eligibleQuantity: 1, suppressedByConflict: true }).diagnosticReason, "reward_suppressed_by_conflict");
});
