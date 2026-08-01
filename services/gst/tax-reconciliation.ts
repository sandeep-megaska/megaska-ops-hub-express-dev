/**
 * Reconciles an invoice's computed GST against the tax Shopify recorded on the
 * order. Two operating models need different cross-checks:
 *
 *  - Tax-EXCLUSIVE store: Shopify adds GST on top at checkout, so the order's
 *    tax total is populated and must equal the invoice's GST line-for-line. A
 *    divergence means the app's HSN rate and Shopify's tax setting disagree.
 *
 *  - Tax-INCLUSIVE store (priceIncludesTax): GST is embedded in the item price
 *    and the app extracts it from the HSN mapping. When such a store does not
 *    charge a separate tax through Shopify (the common India setup, and always
 *    the case for LoopD2C express orders, which are created as draft orders),
 *    the order's tax total is legitimately 0. Comparing the app's inclusive GST
 *    against that 0 would ALWAYS false-flag. The meaningful cross-check there is
 *    that the invoice grand total equals what the customer actually paid.
 *
 * Keeping this pure and dependency-free so both the admin route and the batch
 * dashboard reconcile identically, and so it is unit-testable under `node --test`.
 */

export type TaxReconciliationBasis = "CHECKOUT_TAX" | "GRAND_TOTAL";

export interface TaxReconciliationInput {
  invoiceTax: number;
  shopifyTax: number;
  invoiceTotal: number;
  orderTotal: number;
  priceIncludesTax: boolean;
}

export interface TaxReconciliationResult {
  invoiceTax: number;
  shopifyTax: number;
  invoiceTotal: number;
  orderTotal: number;
  basis: TaxReconciliationBasis;
  matches: boolean;
}

// Re. 1 tolerance absorbs paise-level rounding only.
const RECONCILE_TOLERANCE = 1;

function round2(value: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export function reconcileInvoiceTax(input: TaxReconciliationInput): TaxReconciliationResult {
  const invoiceTax = round2(input.invoiceTax);
  const shopifyTax = round2(input.shopifyTax);
  const invoiceTotal = round2(input.invoiceTotal);
  const orderTotal = round2(input.orderTotal);

  if (input.priceIncludesTax && shopifyTax === 0) {
    return {
      invoiceTax,
      shopifyTax,
      invoiceTotal,
      orderTotal,
      basis: "GRAND_TOTAL",
      matches: Math.abs(invoiceTotal - orderTotal) <= RECONCILE_TOLERANCE,
    };
  }

  return {
    invoiceTax,
    shopifyTax,
    invoiceTotal,
    orderTotal,
    basis: "CHECKOUT_TAX",
    matches: Math.abs(invoiceTax - shopifyTax) <= RECONCILE_TOLERANCE,
  };
}
