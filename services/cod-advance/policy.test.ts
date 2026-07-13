import assert from "node:assert/strict";
import test from "node:test";

import { calculateCodAdvancePolicy, type CodAdvancePolicyInput } from "./policy.ts";

const baseInput: CodAdvancePolicyInput = {
  enabled: true,
  advanceType: "FIXED",
  fixedAdvanceAmountPaise: 30000,
  percentageBasisPoints: null,
  minimumAdvanceAmountPaise: null,
  maximumAdvanceAmountPaise: null,
  minOrderAmountPaise: null,
  maxOrderAmountPaise: null,
  orderTotalPaise: 200000,
  storeCreditAppliedPaise: 0,
};

function policy(overrides: Partial<CodAdvancePolicyInput> = {}) {
  return calculateCodAdvancePolicy({ ...baseInput, ...overrides });
}

test("disabled policy", () => {
  const result = policy({ enabled: false });
  assert.equal(result.available, false);
  assert.equal(result.eligible, false);
  assert.equal(result.requiresAdvance, false);
  assert.deepEqual(result.reasons, ["disabled"]);
});

test("fixed ₹300 on ₹2,000 order", () => {
  const result = policy();
  assert.equal(result.available, true);
  assert.equal(result.eligible, true);
  assert.equal(result.requiresAdvance, true);
  assert.equal(result.advanceAmountPaise, 30000);
  assert.equal(result.codBalanceAmountPaise, 170000);
});

test("fixed advance with Store Credit", () => {
  const result = policy({ storeCreditAppliedPaise: 50000 });
  assert.equal(result.customerCashLiabilityPaise, 150000);
  assert.equal(result.advanceAmountPaise, 30000);
  assert.equal(result.codBalanceAmountPaise, 120000);
});

test("10% percentage calculation", () => {
  const result = policy({ advanceType: "PERCENTAGE", percentageBasisPoints: 1000 });
  assert.equal(result.advanceAmountPaise, 20000);
  assert.equal(result.codBalanceAmountPaise, 180000);
});

test("12.5% basis-point calculation", () => {
  const result = policy({ advanceType: "PERCENTAGE", percentageBasisPoints: 1250 });
  assert.equal(result.advanceAmountPaise, 25000);
});

test("percentage calculation with Store Credit", () => {
  const result = policy({ advanceType: "PERCENTAGE", percentageBasisPoints: 1000, storeCreditAppliedPaise: 50000 });
  assert.equal(result.customerCashLiabilityPaise, 150000);
  assert.equal(result.advanceAmountPaise, 15000);
});

test("percentage rounding to nearest paise", () => {
  const result = policy({ advanceType: "PERCENTAGE", percentageBasisPoints: 3333, orderTotalPaise: 101 });
  assert.equal(result.advanceAmountPaise, 34);
});

test("minimum advance raises calculated advance", () => {
  const result = policy({ advanceType: "PERCENTAGE", percentageBasisPoints: 1000, minimumAdvanceAmountPaise: 30000 });
  assert.equal(result.advanceAmountPaise, 30000);
});

test("maximum advance lowers calculated advance", () => {
  const result = policy({ maximumAdvanceAmountPaise: 20000 });
  assert.equal(result.advanceAmountPaise, 20000);
});

test("minimum and maximum both applied", () => {
  const result = policy({ advanceType: "PERCENTAGE", percentageBasisPoints: 1000, minimumAdvanceAmountPaise: 25000, maximumAdvanceAmountPaise: 28000 });
  assert.equal(result.advanceAmountPaise, 25000);
});

test("advance capped at cash liability", () => {
  const result = policy({ fixedAdvanceAmountPaise: 30000, orderTotalPaise: 20000 });
  assert.equal(result.advanceAmountPaise, 20000);
  assert.equal(result.codBalanceAmountPaise, 0);
});

test("Store Credit equals full order total", () => {
  const result = policy({ storeCreditAppliedPaise: 200000 });
  assert.equal(result.eligible, true);
  assert.equal(result.requiresAdvance, false);
  assert.equal(result.advanceAmountPaise, 0);
  assert.equal(result.codBalanceAmountPaise, 0);
  assert.deepEqual(result.reasons, ["zero_cash_liability"]);
});

test("Store Credit exceeds order total", () => {
  const result = policy({ storeCreditAppliedPaise: 200001 });
  assert.equal(result.available, false);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("store_credit_exceeds_order_total"));
});

test("below minimum order", () => {
  const result = policy({ minOrderAmountPaise: 250000 });
  assert.equal(result.available, true);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["below_min_order_amount"]);
});

test("above maximum order", () => {
  const result = policy({ maxOrderAmountPaise: 150000 });
  assert.equal(result.available, true);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["above_max_order_amount"]);
});

test("order exactly at minimum", () => {
  const result = policy({ minOrderAmountPaise: 200000 });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
});

test("order exactly at maximum", () => {
  const result = policy({ maxOrderAmountPaise: 200000 });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
});

test("invalid negative minimum order threshold", () => {
  const result = policy({ minOrderAmountPaise: -1 });
  assert.equal(result.available, false);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["invalid_min_order_amount"]);
});

test("invalid non-integer minimum order threshold", () => {
  const result = policy({ minOrderAmountPaise: 100.5 });
  assert.equal(result.available, false);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["invalid_min_order_amount"]);
});

test("invalid negative maximum order threshold", () => {
  const result = policy({ maxOrderAmountPaise: -1 });
  assert.equal(result.available, false);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["invalid_max_order_amount"]);
});

test("invalid non-integer maximum order threshold", () => {
  const result = policy({ maxOrderAmountPaise: 100.5 });
  assert.equal(result.available, false);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["invalid_max_order_amount"]);
});

test("fixed amount zero gives normal COD", () => {
  const result = policy({ fixedAdvanceAmountPaise: 0 });
  assert.equal(result.eligible, true);
  assert.equal(result.requiresAdvance, false);
  assert.equal(result.advanceAmountPaise, 0);
  assert.equal(result.codBalanceAmountPaise, 200000);
});

test("invalid negative fixed amount", () => {
  const result = policy({ fixedAdvanceAmountPaise: -1 });
  assert.equal(result.available, false);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("invalid_fixed_advance"));
});

test("invalid percentage 0", () => {
  const result = policy({ advanceType: "PERCENTAGE", percentageBasisPoints: 0 });
  assert.equal(result.available, false);
  assert.ok(result.reasons.includes("invalid_percentage_basis_points"));
});

test("invalid percentage above 10000", () => {
  const result = policy({ advanceType: "PERCENTAGE", percentageBasisPoints: 10001 });
  assert.equal(result.available, false);
  assert.ok(result.reasons.includes("invalid_percentage_basis_points"));
});

test("missing percentage for PERCENTAGE mode", () => {
  const result = policy({ advanceType: "PERCENTAGE", percentageBasisPoints: null });
  assert.equal(result.available, false);
  assert.ok(result.reasons.includes("invalid_percentage_basis_points"));
});

test("invalid negative Store Credit", () => {
  const result = policy({ storeCreditAppliedPaise: -1 });
  assert.equal(result.available, false);
  assert.ok(result.reasons.includes("invalid_store_credit_amount"));
});

test("non-integer monetary input", () => {
  const result = policy({ orderTotalPaise: 100.5 });
  assert.equal(result.available, false);
  assert.ok(result.reasons.includes("invalid_order_total"));
});

test("minimum advance greater than maximum advance", () => {
  const result = policy({ minimumAdvanceAmountPaise: 40000, maximumAdvanceAmountPaise: 30000 });
  assert.equal(result.available, false);
  assert.ok(result.reasons.includes("minimum_advance_exceeds_maximum_advance"));
});

test("no negative COD balance", () => {
  const result = policy({ fixedAdvanceAmountPaise: 999999 });
  assert.equal(result.advanceAmountPaise, 200000);
  assert.equal(result.codBalanceAmountPaise, 0);
  assert.ok(result.codBalanceAmountPaise >= 0);
});

test("large safe-integer liability uses BigInt percentage math", () => {
  const orderTotalPaise = Number.MAX_SAFE_INTEGER;
  const percentageBasisPoints = 5000;
  const expected = Number((BigInt(orderTotalPaise) * BigInt(percentageBasisPoints) + 5000n) / 10000n);

  assert.equal(Number.isSafeInteger(orderTotalPaise * percentageBasisPoints), false);

  const result = policy({
    advanceType: "PERCENTAGE",
    percentageBasisPoints,
    orderTotalPaise,
    fixedAdvanceAmountPaise: 0,
  });

  assert.equal(result.available, true);
  assert.equal(result.eligible, true);
  assert.equal(result.advanceAmountPaise, expected);
  assert.equal(result.codBalanceAmountPaise, orderTotalPaise - expected);
});

test("all returned monetary values are safe integers", () => {
  const result = policy({ advanceType: "PERCENTAGE", percentageBasisPoints: 1250, storeCreditAppliedPaise: 12345 });
  for (const key of [
    "orderTotalPaise",
    "storeCreditAppliedPaise",
    "customerCashLiabilityPaise",
    "advanceAmountPaise",
    "codBalanceAmountPaise",
  ] as const) {
    assert.equal(Number.isSafeInteger(result[key]), true, key);
    assert.ok(result[key] >= 0, key);
  }
});
