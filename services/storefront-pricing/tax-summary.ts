/**
 * Country-neutral projection of pricing already calculated by Shopify.
 *
 * Amounts are integer minor units. This module deliberately contains no tax
 * rates, jurisdiction rules, or arithmetic for deriving tax.
 */
export type ShopifyTaxLine = {
  title: string;
  amount: number;
  rate: number | null;
};

export type TaxSummary = {
  taxesIncluded: boolean;
  currency: string;
  subtotal: number;
  shipping: number;
  discounts: number;
  taxableAmount: number | null;
  taxLines: ShopifyTaxLine[];
  totalTax: number;
  totalPayable: number;
  source: "SHOPIFY";
};

export type PricingDiagnostics = {
  pricingAuthority: "SHOPIFY";
  taxesIncluded: boolean;
  markets: "SHOPIFY_MANAGED";
  taxLines: "PRESENT" | "NONE";
  draftOrderTotal: number;
  paymentTotal: number | null;
  currency: string;
  status: "HEALTHY" | "PAYMENT_BLOCKED" | "AWAITING_PAYMENT";
};

type MoneyLike = { amount?: string | number | null; currencyCode?: string | null } | string | number | null | undefined;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function moneyBag(value: unknown): MoneyLike {
  const node = record(value);
  return (record(node?.shopMoney) || record(node?.presentmentMoney) || node || value) as MoneyLike;
}

function currencyOf(value: unknown): string | null {
  const bag = record(moneyBag(value));
  const currency = String(bag?.currencyCode || "").trim().toUpperCase();
  return currency || null;
}

function minor(value: unknown, exponent: number): number {
  const bag = moneyBag(value);
  const raw = record(bag)?.amount ?? bag;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) throw new Error("Shopify pricing response contains an invalid money amount");
  return Math.round(amount * 10 ** exponent);
}

function read(root: Record<string, unknown>, ...names: string[]) {
  for (const name of names) if (root[name] !== undefined && root[name] !== null) return root[name];
  return undefined;
}

/** Maps a Shopify DraftOrder/Admin API response without recalculating tax. */
export function taxSummaryFromShopifyDraftOrder(input: unknown, options?: { currencyExponent?: number }): TaxSummary {
  const outer = record(input);
  const draft = record(outer?.draftOrder) || outer;
  if (!draft) throw new Error("Shopify draft order pricing is required");
  const exponent = options?.currencyExponent ?? 2;
  const totalValue = read(draft, "totalPriceSet", "totalPrice", "total_price");
  const currency = currencyOf(totalValue) || String(draft.currencyCode || draft.currency || "").trim().toUpperCase();
  if (!currency) throw new Error("Shopify draft order currency is required");

  const rawLines = read(draft, "taxLines", "tax_lines");
  const taxLines = (Array.isArray(rawLines) ? rawLines : []).map((value) => {
    const line = record(value) || {};
    const amountValue = read(line, "priceSet", "price", "amountSet", "amount");
    const lineCurrency = currencyOf(amountValue);
    if (lineCurrency && lineCurrency !== currency) throw new Error("Shopify tax line currency does not match draft order currency");
    const rate = line.rate === null || line.rate === undefined ? null : Number(line.rate);
    return {
      title: String(line.title || line.name || "").trim(),
      amount: minor(amountValue, exponent),
      rate: rate !== null && Number.isFinite(rate) ? rate : null,
    };
  });

  const nullableMoney = (value: unknown) => value === undefined || value === null ? null : minor(value, exponent);
  return {
    taxesIncluded: Boolean(read(draft, "taxesIncluded", "taxes_included")),
    currency,
    subtotal: minor(read(draft, "subtotalPriceSet", "subtotalPrice", "subtotal_price"), exponent),
    shipping: minor(read(draft, "totalShippingPriceSet", "totalShippingPrice", "total_shipping_price") ?? 0, exponent),
    discounts: minor(read(draft, "totalDiscountsSet", "totalDiscounts", "total_discounts") ?? 0, exponent),
    taxableAmount: nullableMoney(read(draft, "taxableAmountSet", "taxableAmount", "taxable_amount")),
    taxLines,
    totalTax: minor(read(draft, "totalTaxSet", "totalTax", "total_tax") ?? 0, exponent),
    totalPayable: minor(totalValue, exponent),
    source: "SHOPIFY",
  };
}

export function assertShopifyPaymentTotal(summary: TaxSummary, payment: { amount: number; currency: string }): void {
  if (summary.source !== "SHOPIFY" || summary.currency !== payment.currency.trim().toUpperCase() || summary.totalPayable !== payment.amount) {
    throw new Error("PAYMENT_TOTAL_MISMATCH: payment blocked because Shopify draft order total differs");
  }
}

export function pricingDiagnostics(summary: TaxSummary, paymentTotal?: number | null): PricingDiagnostics {
  const payment = paymentTotal ?? null;
  return {
    pricingAuthority: "SHOPIFY",
    taxesIncluded: summary.taxesIncluded,
    markets: "SHOPIFY_MANAGED",
    taxLines: summary.taxLines.length ? "PRESENT" : "NONE",
    draftOrderTotal: summary.totalPayable,
    paymentTotal: payment,
    currency: summary.currency,
    status: payment === null ? "AWAITING_PAYMENT" : payment === summary.totalPayable ? "HEALTHY" : "PAYMENT_BLOCKED",
  };
}
