import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync(new URL("../assets/megaska-express-checkout.js", import.meta.url), "utf8");
const modalSource = readFileSync(new URL("../extensions/megaska-otp/assets/megaska-express-modal.js", import.meta.url), "utf8");

test("summary uses the additive pricing view and Shopify total without local total arithmetic", () => {
  assert.match(source, /const current = status === "CURRENT" && pricing\?\.authoritative/);
  assert.match(source, /totalPayableMinor: intent\.totalAmountPaise/);
  assert.doesNotMatch(source, /subtotalMinor\s*-\s*.*discountsMinor|subtotalMinor\s*\+\s*.*totalTaxMinor/);
});

test("inclusive, exclusive, multiple, zero tax and snapshot states are customer-safe", () => {
  for (const checkoutSource of [source, modalSource]) {
    assert.match(checkoutSource, /pricing\.taxesIncluded === true \? `Includes \$\{title\}` : title/);
    assert.match(checkoutSource, /detailed\.length/);
    assert.match(checkoutSource, /amountMinor <= 0/);
    assert.match(checkoutSource, /Includes tax/);
    assert.match(checkoutSource, /Updating shipping, discounts and tax/);
    assert.match(checkoutSource, /pricing\?\.status !== "CURRENT" \|\| pricing\.authoritative !== true/);
    assert.doesNotMatch(checkoutSource, /Snapshot invalidated|Draft Order stale|Fingerprint mismatch/);
  }
});

test("currency formatter derives the ISO currency exponent for JPY and other currencies", () => {
  for (const checkoutSource of [source, modalSource]) assert.match(checkoutSource, /resolvedOptions\(\)\.maximumFractionDigits/);
});

test("tax rows precede payable and do not change the Shopify-authoritative amount", () => {
  assert.ok(source.indexOf('...taxRows.map') < source.indexOf('class="megaska-express-total"'));
  assert.match(modalSource, /\$\{checkoutTaxSummary\(\)\}<p class="megaska-express-total"><span>You pay<\/span><strong>\$\{totalAmount\}/);
  assert.doesNotMatch(modalSource, /totalAmountPaise\s*[+\-]\s*.*totalTaxMinor/);
  assert.match(modalSource, /state\.pricing = data\.pricing \|\| null/);
});
