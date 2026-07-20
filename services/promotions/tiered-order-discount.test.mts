import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeTieredOrderReward, DEFAULT_ORDER_REWARD_COMBINATION_POLICY, evaluateTierProgress, normalizeDecimal, resolveOrderRewardCandidate, validateTieredOrderReward, type OrderDiscountTier, type TieredOrderPercentageReward } from "./tiered-order-discount.ts";

const reward = (tiers: OrderDiscountTier[], continuityMode: "continuous" | "allow_gaps" = "continuous"): TieredOrderPercentageReward => ({ scope: "order", method: "percentage", configuration: { selectionMode: "highest_eligible", continuityMode, basis: "eligible_merchandise_subtotal", tiers } });
const continuous = [
  { id: "tier-1", minimumSubtotal: "0.00", maximumSubtotal: "1000.00", percentage: "5.00" },
  { id: "tier-2", minimumSubtotal: "1000", maximumSubtotal: "2000", percentage: "10" },
  { id: "tier-3", minimumSubtotal: "2000", percentage: "15" },
];
const codes = (input: Parameters<typeof validateTieredOrderReward>[0]) => validateTieredOrderReward(input).issues.map((entry) => entry.code);

test("validates empty, continuous, gapped, and open-ended configurations", () => {
  assert.deepEqual(codes(reward([])), ["TIER_REQUIRED"]);
  assert.equal(validateTieredOrderReward(reward([{ id: "only", minimumSubtotal: 0, percentage: 5 }])).valid, true);
  assert.equal(validateTieredOrderReward(reward(continuous)).valid, true);
  const gap = [{ id: "a", minimumSubtotal: 1000, maximumSubtotal: 2000, percentage: 5 }, { id: "b", minimumSubtotal: 3000, percentage: 10 }];
  assert.equal(validateTieredOrderReward(reward(gap, "allow_gaps")).valid, true);
  assert.ok(codes(reward(gap)).includes("TIER_GAP_NOT_ALLOWED"));
});

test("detects overlaps, duplicates, and invalid open-ended placement", () => {
  assert.ok(codes(reward([{ id: "a", minimumSubtotal: 0, maximumSubtotal: 20, percentage: 5 }, { id: "b", minimumSubtotal: 10, maximumSubtotal: 30, percentage: 10 }], "allow_gaps")).includes("TIER_OVERLAP"));
  const duplicates = codes(reward([{ id: "same", minimumSubtotal: 0, maximumSubtotal: 10, percentage: 5 }, { id: "same", minimumSubtotal: "0.0", maximumSubtotal: "10.00", percentage: 10 }]));
  assert.ok(duplicates.includes("TIER_DUPLICATE_ID")); assert.ok(duplicates.includes("TIER_DUPLICATE_MINIMUM")); assert.ok(duplicates.includes("TIER_DUPLICATE_RANGE"));
  const open = codes(reward([{ id: "open", minimumSubtotal: 0, percentage: 5 }, { id: "later", minimumSubtotal: 10, percentage: 10 }], "allow_gaps"));
  assert.ok(open.includes("TIER_MULTIPLE_OPEN_ENDED")); assert.ok(open.includes("TIER_AFTER_OPEN_ENDED"));
});

test("rejects malformed and out-of-range decimals", () => {
  for (const [field, value, expected] of [
    ["minimumSubtotal", -1, "TIER_MINIMUM_NEGATIVE"], ["maximumSubtotal", -1, "TIER_MAXIMUM_NEGATIVE"],
    ["percentage", 0, "TIER_PERCENTAGE_INVALID"], ["percentage", 101, "TIER_PERCENTAGE_INVALID"],
    ["minimumSubtotal", "1e3", "TIER_DECIMAL_MALFORMED"],
  ] as const) {
    const tier = { id: "a", minimumSubtotal: 0, maximumSubtotal: 10, percentage: 5, [field]: value };
    assert.ok(codes(reward([tier])).includes(expected));
  }
  assert.ok(codes(reward([{ id: "a", minimumSubtotal: 10, maximumSubtotal: 10, percentage: 5 }])).includes("TIER_MAXIMUM_INVALID"));
  assert.ok(codes(reward([{ id: "a", minimumSubtotal: 10, maximumSubtotal: 9, percentage: 5 }])).includes("TIER_MAXIMUM_INVALID"));
  assert.equal(normalizeDecimal("0010.5000"), "10.5"); assert.equal(normalizeDecimal("1e3"), null);
});

test("fails unsupported capabilities and basis closed without becoming executable", () => {
  const result = validateTieredOrderReward({ scope: "order", method: "fixed_amount", configuration: { ...reward(continuous).configuration, basis: "other" as never } });
  assert.equal(result.executable, false); assert.ok(result.issues.some((entry) => entry.code === "TIER_UNSUPPORTED_REWARD")); assert.ok(result.issues.some((entry) => entry.code === "TIER_UNSUPPORTED_BASIS"));
  assert.deepEqual(DEFAULT_ORDER_REWARD_COMBINATION_POLICY, { combineWithProductDiscounts: true, combineWithOrderDiscounts: false, combineWithShippingDiscounts: true });
});

test("uses inclusive minimums, exclusive maximums, gaps, and deterministic unsorted input", () => {
  assert.equal(evaluateTierProgress(continuous, -1).activeTier, undefined);
  assert.equal(evaluateTierProgress(continuous, 0).activeTier?.id, "tier-1");
  assert.equal(evaluateTierProgress(continuous, 999.5).activeTier?.id, "tier-1");
  assert.equal(evaluateTierProgress(continuous, 1000).activeTier?.id, "tier-2");
  assert.equal(evaluateTierProgress([...continuous].reverse(), 2500).activeTier?.id, "tier-3");
  assert.equal(evaluateTierProgress([{ id: "a", minimumSubtotal: 0, maximumSubtotal: 1000, percentage: 5 }, { id: "b", minimumSubtotal: 2000, percentage: 10 }], 1500).activeTier, undefined);
});

test("discovers next tiers and decimal-safe non-negative progress", () => {
  assert.deepEqual([evaluateTierProgress(continuous, -1).nextTier?.id, evaluateTierProgress(continuous, 500).nextTier?.id, evaluateTierProgress(continuous, 2500).nextTier], ["tier-1", "tier-2", undefined]);
  assert.equal(evaluateTierProgress(continuous, 500).amountToNextTier, "500");
  assert.equal(evaluateTierProgress(continuous, 1000).amountToNextTier, "1000");
  assert.equal(evaluateTierProgress(continuous, 2500).highestTierReached, true);
});

test("canonical serialization ignores tier order and equivalent decimal spelling", () => {
  const first = canonicalizeTieredOrderReward(reward(continuous));
  const second = canonicalizeTieredOrderReward(reward([{ id: "tier-3", minimumSubtotal: "2000.0", percentage: "15.0" }, { id: "tier-1", minimumSubtotal: 0, maximumSubtotal: 1000, percentage: 5 }, { id: "tier-2", minimumSubtotal: "1000.00", maximumSubtotal: "2000.0", percentage: "10.0" }]));
  assert.deepEqual(first, second); assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal("databaseId" in first.configuration.tiers[0], false);
});

test("order conflicts choose priority, then benefit, then stable rule ID and never compound", () => {
  const candidate = (sourceRuleId: string, priority: number, percentage: string) => ({ scope: "order" as const, method: "percentage" as const, percentage, sourceRuleId, sourceTierId: "tier", priority, combinationPolicy: DEFAULT_ORDER_REWARD_COMBINATION_POLICY });
  assert.equal(resolveOrderRewardCandidate([candidate("low", 1, "90"), candidate("high", 2, "5")], 100)?.sourceRuleId, "high");
  assert.equal(resolveOrderRewardCandidate([candidate("low", 1, "5"), candidate("benefit", 1, "10")], 100)?.sourceRuleId, "benefit");
  assert.equal(resolveOrderRewardCandidate([candidate("b", 1, "10"), candidate("a", 1, "10")], 100)?.sourceRuleId, "a");
  assert.equal(Array.isArray(resolveOrderRewardCandidate([candidate("a", 1, "10"), candidate("b", 1, "20")], 100)), false);
});
