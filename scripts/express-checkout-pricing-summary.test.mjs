import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync(new URL("../assets/megaska-express-checkout.js", import.meta.url), "utf8");

test("summary uses the additive pricing view and Shopify total without local total arithmetic", () => {
  assert.match(source, /const current = status === "CURRENT" && pricing\?\.authoritative/);
  assert.match(source, /totalPayableMinor: intent\.totalAmountPaise/);
  assert.doesNotMatch(source, /subtotalMinor\s*-\s*.*discountsMinor|subtotalMinor\s*\+\s*.*totalTaxMinor/);
});

test("inclusive, exclusive, multiple, zero tax and snapshot states are customer-safe", () => {
  assert.match(source, /values\.taxesIncluded === true \? "Includes " : ""/);
  assert.match(source, /renderedTaxLines\.map/);
  assert.match(source, /filter\(\(line\) => Number\(line\?\.amountMinor \|\| 0\) !== 0/);
  assert.match(source, /Recalculating shipping, discounts and tax/);
  assert.match(source, /Estimated total/);
  assert.doesNotMatch(source, /Snapshot invalidated|Draft Order stale|Fingerprint mismatch/);
});

test("currency formatter derives the ISO currency exponent for JPY and other currencies", () => {
  assert.match(source, /resolvedOptions\(\)\.maximumFractionDigits/);
  assert.doesNotMatch(source, /minorUnits \|\| 0\) \/ 100/);
});
