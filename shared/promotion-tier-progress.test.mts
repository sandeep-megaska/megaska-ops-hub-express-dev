import assert from "node:assert/strict";
import test from "node:test";
import { buildTierProgressViewModel } from "./promotion-tier-progress.ts";

const tiers = [
  { publicId: "one", position: 0, minimumSubtotal: "1", maximumSubtotal: "1000", percentage: "5" },
  { publicId: "two", position: 1, minimumSubtotal: "1000", maximumSubtotal: "2000", percentage: "10" },
  { publicId: "three", position: 2, minimumSubtotal: "2000", maximumSubtotal: null, percentage: "15" },
];
const build = (subtotal: number, overrides = {}) => buildTierProgressViewModel({ qualifyingSubtotal: subtotal, tiers, currencyCode: "INR", selectionMode: "highest_eligible", continuityMode: "continuous", promotionPublicId: "promo", ...overrides });

test("selects inclusive minimums, exclusive maximums, and the next target", () => {
  assert.equal(build(0).state, "BELOW_FIRST_TIER");
  assert.equal(build(1).currentTier?.publicId, "one");
  assert.equal(build(999.99).currentTier?.publicId, "one");
  assert.equal(build(1000).currentTier?.publicId, "two");
  assert.equal(build(1999.99).currentTier?.publicId, "two");
  assert.equal(build(2000).state, "HIGHEST_TIER_UNLOCKED");
  assert.equal(build(1080).amountToNextTier, 920);
});

test("marks previous, current, next and highest tiers", () => {
  const result = build(1200);
  assert.deepEqual(result.tiers.map(({ isUnlocked, isCurrent, isNext }) => [isUnlocked, isCurrent, isNext]), [[true, false, false], [true, true, false], [false, false, true]]);
  assert.equal(result.highestTier?.publicId, "three");
  assert.equal(result.progressPercent, 20);
  assert.equal(build(2400).progressPercent, 100);
});

test("canonicalizes unsorted input and supports configured gaps", () => {
  assert.equal(build(1000, { tiers: [...tiers].reverse() }).currentTier?.publicId, "two");
  const result = build(1500, { continuityMode: "allow_gaps", tiers: [{ ...tiers[0], maximumSubtotal: 1000 }, { ...tiers[2], minimumSubtotal: 2000 }] });
  assert.equal(result.currentTier, null); assert.equal(result.nextTier?.publicId, "three"); assert.equal(result.amountToNextTier, 500);
});

test("fails closed for overlaps, zero-width intervals, percentages, and unsupported contracts", () => {
  assert.equal(build(10, { tiers: [{ ...tiers[0], maximumSubtotal: 1 }] }).enabled, false);
  assert.equal(build(10, { tiers: [{ ...tiers[0], percentage: 0 }] }).enabled, false);
  assert.equal(build(10, { tiers: [tiers[0], { ...tiers[1], minimumSubtotal: 999 }] }).enabled, false);
  assert.equal(build(10, { selectionMode: "first" }).enabled, false);
});
