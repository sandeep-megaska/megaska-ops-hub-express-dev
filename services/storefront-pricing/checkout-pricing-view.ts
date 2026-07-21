import type { ShopifyCheckoutPricingSnapshot } from "./pricing-snapshot-types.ts";
import { normalizeCheckoutTaxTitle } from "./checkout-tax-display.ts";

export type ExpressCheckoutPricingView = {
  status: "CURRENT" | "INVALIDATED" | "REFRESHING" | "UNAVAILABLE";
  authoritative: boolean;
  currency: string | null;
  subtotalMinor: number | null;
  discountsMinor: number | null;
  shippingMinor: number | null;
  totalTaxMinor: number | null;
  totalPayableMinor: number | null;
  taxesIncluded: boolean | null;
  taxLines: Array<{ title: string; amountMinor: number; rate: number | null }>;
  authoritativeAt: string | null;
  messageCode: "pricing_current" | "pricing_recalculating" | "pricing_refresh_required" | "pricing_unavailable";
};

/** Customer-safe projection only. Shopify's total is the order total before settlement instruments such as Store Credit. */
export function checkoutPricingView(
  snapshot: ShopifyCheckoutPricingSnapshot | null,
  options: { refreshing?: boolean } = {},
): ExpressCheckoutPricingView {
  if (!snapshot) return emptyView(options.refreshing ? "REFRESHING" : "UNAVAILABLE");
  const status = options.refreshing ? "REFRESHING" : snapshot.status;
  const summary = snapshot.taxSummary;
  if (summary && snapshot.currency && summary.currency !== snapshot.currency) return emptyView("UNAVAILABLE");

  return {
    status,
    authoritative: status === "CURRENT",
    currency: snapshot.currency,
    subtotalMinor: snapshot.subtotalMinor,
    discountsMinor: snapshot.discountsMinor,
    shippingMinor: snapshot.shippingMinor,
    totalTaxMinor: snapshot.totalTaxMinor,
    totalPayableMinor: snapshot.totalPayableMinor,
    taxesIncluded: snapshot.taxesIncluded,
    taxLines: (summary?.taxLines ?? []).map((line) => ({ title: normalizeCheckoutTaxTitle(line.title), amountMinor: line.amount, rate: line.rate })),
    authoritativeAt: snapshot.authoritativeAt?.toISOString() ?? null,
    messageCode: status === "CURRENT" ? "pricing_current" : status === "REFRESHING" ? "pricing_recalculating" : "pricing_refresh_required",
  };
}

function emptyView(status: "REFRESHING" | "UNAVAILABLE"): ExpressCheckoutPricingView {
  return {
    status,
    authoritative: false,
    currency: null,
    subtotalMinor: null,
    discountsMinor: null,
    shippingMinor: null,
    totalTaxMinor: null,
    totalPayableMinor: null,
    taxesIncluded: null,
    taxLines: [],
    authoritativeAt: null,
    messageCode: status === "REFRESHING" ? "pricing_recalculating" : "pricing_unavailable",
  };
}
