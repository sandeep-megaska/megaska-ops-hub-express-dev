import assert from "node:assert/strict";
import test from "node:test";
import { assertShopifyPaymentTotal, pricingDiagnostics, taxSummaryFromShopifyDraftOrder } from "./tax-summary.ts";

const money = (amount: string, currencyCode = "INR") => ({ shopMoney: { amount, currencyCode } });

test("preserves Shopify inclusive tax totals and labels", () => {
  const summary = taxSummaryFromShopifyDraftOrder({
    taxesIncluded: true,
    subtotalPriceSet: money("1000"), totalDiscountsSet: money("100"),
    totalShippingPriceSet: money("0"), totalTaxSet: money("137.29"), totalPriceSet: money("900"),
    taxLines: [{ title: "GST", rate: 0.18, priceSet: money("137.29") }],
  });
  assert.deepEqual(summary, { taxesIncluded: true, currency: "INR", subtotal: 100000, shipping: 0, discounts: 10000, taxableAmount: null, taxLines: [{ title: "GST", rate: 0.18, amount: 13729 }], totalTax: 13729, totalPayable: 90000, source: "SHOPIFY" });
  assert.equal(pricingDiagnostics(summary, 90000).status, "HEALTHY");
});

test("supports added tax without applying a country-specific formula", () => {
  const summary = taxSummaryFromShopifyDraftOrder({ taxes_included: false, subtotal_price: "100.00", total_shipping_price: "0", total_discounts: "10", total_tax: "8.10", total_price: "98.10", currency: "USD", tax_lines: [{ title: "Sales Tax", price: "8.10", rate: 0.09 }] });
  assert.equal(summary.totalPayable, 9810);
  assert.equal(summary.taxLines[0]?.title, "Sales Tax");
  assert.doesNotThrow(() => assertShopifyPaymentTotal(summary, { amount: 9810, currency: "USD" }));
  assert.throws(() => assertShopifyPaymentTotal(summary, { amount: 9809, currency: "USD" }), /PAYMENT_TOTAL_MISMATCH/);
});

test("supports exempt and zero-decimal market currencies", () => {
  const summary = taxSummaryFromShopifyDraftOrder({ taxesIncluded: false, subtotalPrice: { amount: "1000", currencyCode: "JPY" }, totalPrice: { amount: "1000", currencyCode: "JPY" }, totalTax: { amount: "0", currencyCode: "JPY" }, taxLines: [] }, { currencyExponent: 0 });
  assert.equal(summary.totalTax, 0);
  assert.equal(summary.totalPayable, 1000);
  assert.equal(pricingDiagnostics(summary).status, "AWAITING_PAYMENT");
});
