import type { ExpressCheckoutPricingView } from "./checkout-pricing-view.ts";

export type CheckoutTaxDisplayRow = {
  key: string;
  label: string;
  amountMinor: number;
};

const MAX_TAX_TITLE_LENGTH = 120;

/** Normalizes Shopify-owned display text without interpreting its tax meaning. */
export function normalizeCheckoutTaxTitle(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAX_TITLE_LENGTH);
}

/** Builds informational rows only; it never derives tax or the payable total. */
export function buildCheckoutTaxDisplayRows(
  pricing: ExpressCheckoutPricingView | null | undefined,
): CheckoutTaxDisplayRow[] {
  if (pricing?.status !== "CURRENT" || pricing.authoritative !== true) return [];

  const detailed = (Array.isArray(pricing.taxLines) ? pricing.taxLines : []).flatMap((line, index) => {
    const title = normalizeCheckoutTaxTitle(line?.title);
    const amountMinor = Number(line?.amountMinor);
    if (!title || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return [];
    return [{
      key: `tax-line-${index}-${title}`,
      label: pricing.taxesIncluded === true ? `Includes ${title}` : title,
      amountMinor,
    }];
  });
  if (detailed.length) return detailed;

  const totalTaxMinor = Number(pricing.totalTaxMinor);
  if (!Number.isSafeInteger(totalTaxMinor) || totalTaxMinor <= 0) return [];
  return [{
    key: "tax-total-fallback",
    label: pricing.taxesIncluded === true ? "Includes tax" : "Tax",
    amountMinor: totalTaxMinor,
  }];
}
