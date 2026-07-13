import test from "node:test";
import assert from "node:assert/strict";

import { calculateCodAdvancePolicy, calculateRoundedPercentagePaise, type CodAdvancePolicySettings } from "./policy.ts";

const baseSettings: CodAdvancePolicySettings = {
  enabled: true,
  advanceBasisPoints: 1000,
  minOrderAmountPaise: null,
  maxOrderAmountPaise: null,
  policyText: null,
  currency: "INR",
};

test("negative minOrderAmountPaise returns stable invalid reason", () => {
  const result = calculateCodAdvancePolicy({ ...baseSettings, minOrderAmountPaise: -1 }, 10_000);

  assert.equal(result.eligibility.eligible, false);
  assert.deepEqual(result.eligibility.reasons, ["invalid_min_order_amount"]);
});

test("non-integer minOrderAmountPaise returns stable invalid reason", () => {
  const result = calculateCodAdvancePolicy({ ...baseSettings, minOrderAmountPaise: 100.5 }, 10_000);

  assert.equal(result.eligibility.eligible, false);
  assert.deepEqual(result.eligibility.reasons, ["invalid_min_order_amount"]);
});

test("negative maxOrderAmountPaise returns stable invalid reason", () => {
  const result = calculateCodAdvancePolicy({ ...baseSettings, maxOrderAmountPaise: -1 }, 10_000);

  assert.equal(result.eligibility.eligible, false);
  assert.deepEqual(result.eligibility.reasons, ["invalid_max_order_amount"]);
});

test("non-integer maxOrderAmountPaise returns stable invalid reason", () => {
  const result = calculateCodAdvancePolicy({ ...baseSettings, maxOrderAmountPaise: 100.5 }, 10_000);

  assert.equal(result.eligibility.eligible, false);
  assert.deepEqual(result.eligibility.reasons, ["invalid_max_order_amount"]);
});

test("order amount threshold reasons are emitted only for valid configured thresholds", () => {
  assert.deepEqual(
    calculateCodAdvancePolicy({ ...baseSettings, minOrderAmountPaise: 20_000 }, 10_000).eligibility.reasons,
    ["below_min_order_amount"],
  );
  assert.deepEqual(
    calculateCodAdvancePolicy({ ...baseSettings, maxOrderAmountPaise: 5_000 }, 10_000).eligibility.reasons,
    ["above_max_order_amount"],
  );
  assert.deepEqual(
    calculateCodAdvancePolicy({ ...baseSettings, minOrderAmountPaise: -1, maxOrderAmountPaise: 5_000 }, 10_000).eligibility.reasons,
    ["invalid_min_order_amount", "above_max_order_amount"],
  );
});

test("percentage calculation uses BigInt arithmetic and nearest-paise rounding", () => {
  assert.equal(calculateRoundedPercentagePaise(10_005, 5000), 5_003);
});

test("large safe-integer cash liability keeps unsafe Number multiplication out of percentage math", () => {
  const amountPaise = Number.MAX_SAFE_INTEGER;
  const basisPoints = 5000;
  const expected = (BigInt(amountPaise) * BigInt(basisPoints) + 5000n) / 10000n;

  assert.equal(Number.isSafeInteger(amountPaise * basisPoints), false);
  assert.equal(calculateRoundedPercentagePaise(amountPaise, basisPoints), Number(expected));

  const result = calculateCodAdvancePolicy({ ...baseSettings, advanceBasisPoints: basisPoints }, amountPaise);
  assert.equal(result.eligibility.eligible, true);
  assert.equal(result.advanceAmount, Number(expected));
});
