import test from "node:test";
import assert from "node:assert/strict";
import { formatBillingMoney, formatBillingQuantity, usageProgress } from "./billing-format.ts";

test("billing presentation formats currency without a hardcoded symbol and preserves large quantities", () => {
  assert.match(formatBillingMoney({ amount: "12.5", currency: "USD", locale: "en-US" }), /\$12\.50/);
  assert.equal(formatBillingMoney({ amount: "12.5", currency: "INVALID" }), "12.5 INVALID");
  assert.equal(formatBillingQuantity("900719925474099312345.670000"), "900,719,925,474,099,312,345.67");
});

test("usage progress safely handles zero included allowance", () => {
  assert.deepEqual(usageProgress("1", "0"), { label: "No included allowance", value: 0 });
});
