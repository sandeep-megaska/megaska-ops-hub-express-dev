import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthoritativePricingSnapshot } from "./pricing-snapshot-validation.ts";
import type { TaxSummary } from "./tax-summary.ts";

const taxSummary = (o: Partial<TaxSummary> = {}): TaxSummary => ({ taxesIncluded: false, currency: "USD", subtotal: 100, shipping: 0, discounts: 0, taxableAmount: 100, taxLines: [], totalTax: 0, totalPayable: 100, source: "SHOPIFY", ...o });
const valid = (o: Record<string, unknown> = {}) => ({ source: "SHOPIFY", currency: "USD", subtotalMinor: 100, discountsMinor: 0, shippingMinor: 0, totalTaxMinor: 0, totalPayableMinor: 100, taxesIncluded: false, taxSummary: taxSummary(), refreshReason: "manual_refresh", ...o } as never);
const rejects = (o: Record<string, unknown>, pattern: RegExp) => assert.throws(() => validateAuthoritativePricingSnapshot(valid(o)), pattern);

test("rejects invalid source, currency, fractional and negative minor-unit amounts", () => {
  rejects({ source: "LOCAL" }, /SHOPIFY/); rejects({ currency: "usd" }, /Currency/); rejects({ totalPayableMinor: 1.2 }, /integer/); rejects({ totalPayableMinor: -1 }, /integer/); rejects({ totalTaxMinor: -1 }, /integer/); rejects({ shippingMinor: -1 }, /integer/); rejects({ discountsMinor: -1 }, /integer/);
});
test("rejects mismatched TaxSummary currency and totals", () => {
  rejects({ taxSummary: taxSummary({ currency: "INR" }) }, /currency does not match/); rejects({ taxSummary: taxSummary({ totalPayable: 99 }) }, /total payable/); rejects({ taxSummary: taxSummary({ totalTax: 1 }) }, /total tax/);
});
test("accepts inclusive, exclusive, zero-tax, and normalized zero-decimal currency summaries", () => {
  assert.equal(validateAuthoritativePricingSnapshot(valid()).taxSummary.taxesIncluded, false);
  assert.equal(validateAuthoritativePricingSnapshot(valid({ taxesIncluded: true, taxSummary: taxSummary({ taxesIncluded: true }) })).taxSummary.taxesIncluded, true);
  const jpy = taxSummary({ currency: "JPY", subtotal: 1000, taxableAmount: 1000, totalPayable: 1000 });
  assert.equal(validateAuthoritativePricingSnapshot(valid({ currency: "JPY", subtotalMinor: 1000, totalPayableMinor: 1000, taxSummary: jpy })).totalPayableMinor, 1000);
});
