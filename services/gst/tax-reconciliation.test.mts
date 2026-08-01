import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileInvoiceTax } from "./tax-reconciliation.ts";

test("tax-exclusive: matches when invoice GST equals Shopify tax", () => {
  const result = reconcileInvoiceTax({
    invoiceTax: 54.64,
    shopifyTax: 54.64,
    invoiceTotal: 1147.5,
    orderTotal: 1147.5,
    priceIncludesTax: false,
  });
  assert.equal(result.basis, "CHECKOUT_TAX");
  assert.equal(result.matches, true);
});

test("tax-exclusive: mismatch when invoice GST diverges from Shopify tax", () => {
  const result = reconcileInvoiceTax({
    invoiceTax: 54.64,
    shopifyTax: 0,
    invoiceTotal: 1147.5,
    orderTotal: 1147.5,
    priceIncludesTax: false,
  });
  assert.equal(result.basis, "CHECKOUT_TAX");
  assert.equal(result.matches, false);
});

test("tax-inclusive + no Shopify tax: reconciles on grand total, not tax-vs-zero", () => {
  // The reported LoopD2C express order: invoice GST 54.64 embedded in a 1147.50
  // total, Shopify records 0 separate tax. Must NOT flag a mismatch.
  const result = reconcileInvoiceTax({
    invoiceTax: 54.64,
    shopifyTax: 0,
    invoiceTotal: 1147.5,
    orderTotal: 1147.5,
    priceIncludesTax: true,
  });
  assert.equal(result.basis, "GRAND_TOTAL");
  assert.equal(result.matches, true);
});

test("tax-inclusive + no Shopify tax: mismatch when invoice total != order total", () => {
  const result = reconcileInvoiceTax({
    invoiceTax: 54.64,
    shopifyTax: 0,
    invoiceTotal: 1147.5,
    orderTotal: 1200.0,
    priceIncludesTax: true,
  });
  assert.equal(result.basis, "GRAND_TOTAL");
  assert.equal(result.matches, false);
});

test("tax-inclusive but Shopify DID charge tax: still compares tax-vs-tax", () => {
  // A native order on an inclusive store where Shopify reports the included tax.
  const result = reconcileInvoiceTax({
    invoiceTax: 54.64,
    shopifyTax: 54.64,
    invoiceTotal: 1147.5,
    orderTotal: 1147.5,
    priceIncludesTax: true,
  });
  assert.equal(result.basis, "CHECKOUT_TAX");
  assert.equal(result.matches, true);
});

test("within Re.1 rounding tolerance still matches", () => {
  assert.equal(
    reconcileInvoiceTax({ invoiceTax: 54.64, shopifyTax: 55.5, invoiceTotal: 0, orderTotal: 0, priceIncludesTax: false }).matches,
    true,
  );
  assert.equal(
    reconcileInvoiceTax({ invoiceTax: 54.64, shopifyTax: 0, invoiceTotal: 1147.5, orderTotal: 1148.4, priceIncludesTax: true }).matches,
    true,
  );
});
