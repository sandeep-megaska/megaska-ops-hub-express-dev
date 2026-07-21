import assert from "node:assert/strict";
import test from "node:test";
import { buildCheckoutTaxDisplayRows } from "./checkout-tax-display.ts";

function pricing(overrides: Record<string, unknown> = {}) {
  return {
    status: "CURRENT", authoritative: true, currency: "INR", subtotalMinor: 65400, discountsMinor: 3270,
    shippingMinor: 0, totalTaxMinor: 9478, totalPayableMinor: 62130, taxesIncluded: true,
    taxLines: [{ title: "IGST 18%", amountMinor: 9478, rate: .18 }], authoritativeAt: null, messageCode: "pricing_current",
    ...overrides,
  } as any;
}

test("included and excluded Shopify titles are presented without tax arithmetic", () => {
  assert.deepEqual(buildCheckoutTaxDisplayRows(pricing()), [{ key: "tax-line-0-IGST 18%", label: "Includes IGST 18%", amountMinor: 9478 }]);
  assert.equal(buildCheckoutTaxDisplayRows(pricing({ taxesIncluded: false }))[0].label, "IGST 18%");
});

test("multiple included and excluded lines remain separate and ordered", () => {
  const taxLines = [{ title: "CGST 9%", amountMinor: 4739 }, { title: "SGST 9%", amountMinor: 4739 }];
  assert.deepEqual(buildCheckoutTaxDisplayRows(pricing({ taxLines })).map((row) => row.label), ["Includes CGST 9%", "Includes SGST 9%"]);
  assert.deepEqual(buildCheckoutTaxDisplayRows(pricing({ taxLines, taxesIncluded: false })).map((row) => row.label), ["CGST 9%", "SGST 9%"]);
});

test("zero tax has no row and positive aggregate uses the neutral fallback", () => {
  assert.deepEqual(buildCheckoutTaxDisplayRows(pricing({ taxLines: [], totalTaxMinor: 0 })), []);
  assert.equal(buildCheckoutTaxDisplayRows(pricing({ taxLines: [] }))[0].label, "Includes tax");
  assert.equal(buildCheckoutTaxDisplayRows(pricing({ taxLines: [], taxesIncluded: false }))[0].label, "Tax");
});

test("valid details suppress the aggregate fallback and repeated titles have unique keys", () => {
  const rows = buildCheckoutTaxDisplayRows(pricing({ taxLines: [{ title: "State tax", amountMinor: 400 }, { title: "State tax", amountMinor: 500 }], totalTaxMinor: 900 }));
  assert.equal(rows.length, 2); assert.notEqual(rows[0].key, rows[1].key);
});

test("non-current or missing pricing never presents stale authoritative tax", () => {
  assert.deepEqual(buildCheckoutTaxDisplayRows(pricing({ status: "INVALIDATED", authoritative: false })), []);
  assert.deepEqual(buildCheckoutTaxDisplayRows(pricing({ status: "REFRESHING", authoritative: false })), []);
  assert.deepEqual(buildCheckoutTaxDisplayRows(undefined), []);
});

test("external titles are whitespace/control normalized and bounded", () => {
  const label = buildCheckoutTaxDisplayRows(pricing({ taxLines: [{ title: "  VAT\u0000   20%  ", amountMinor: 2000 }] }))[0].label;
  assert.equal(label, "Includes VAT 20%");
  assert.ok(buildCheckoutTaxDisplayRows(pricing({ taxLines: [{ title: "x".repeat(200), amountMinor: 1 }] }))[0].label.length <= 129);
});

test("global and zero-decimal fixtures retain authoritative minor amounts", () => {
  assert.equal(buildCheckoutTaxDisplayRows(pricing({ currency: "EUR", taxLines: [{ title: "VAT", amountMinor: 2000 }] }))[0].amountMinor, 2000);
  assert.equal(buildCheckoutTaxDisplayRows(pricing({ currency: "JPY", taxesIncluded: false, taxLines: [{ title: "Sales tax", amountMinor: 820 }] }))[0].amountMinor, 820);
});
