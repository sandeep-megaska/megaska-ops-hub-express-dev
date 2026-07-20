import type { TaxSummary } from "./tax-summary.ts";
import { PRICING_SNAPSHOT_REFRESH_REASONS, type AuthoritativePricingSnapshotInput } from "./pricing-snapshot-types.ts";

export class PricingSnapshotValidationError extends Error {
  constructor(message: string) { super(message); this.name = "PricingSnapshotValidationError"; }
}

const CURRENCY = /^[A-Z]{3}$/;
const DRAFT_ORDER_GID = /^gid:\/\/shopify\/DraftOrder\/[1-9]\d*$/;
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function minor(value: unknown, field: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PricingSnapshotValidationError(`${field} must be a non-negative integer in minor units`);
  }
  return value;
}

/** Runtime validation boundary for JSON read from persistence. */
export function parseTaxSummary(value: unknown): TaxSummary {
  const summary = object(value);
  if (!summary || summary.source !== "SHOPIFY" || typeof summary.taxesIncluded !== "boolean" ||
      typeof summary.currency !== "string" || !CURRENCY.test(summary.currency)) {
    throw new PricingSnapshotValidationError("Stored TaxSummary is invalid");
  }
  const subtotal = minor(summary.subtotal, "TaxSummary.subtotal")!;
  const shipping = minor(summary.shipping, "TaxSummary.shipping")!;
  const discounts = minor(summary.discounts, "TaxSummary.discounts")!;
  const taxableAmount = minor(summary.taxableAmount, "TaxSummary.taxableAmount", true);
  const totalTax = minor(summary.totalTax, "TaxSummary.totalTax")!;
  const totalPayable = minor(summary.totalPayable, "TaxSummary.totalPayable")!;
  if (!Array.isArray(summary.taxLines)) throw new PricingSnapshotValidationError("TaxSummary.taxLines must be an array");
  const taxLines = summary.taxLines.map((raw) => {
    const line = object(raw);
    if (!line || typeof line.title !== "string") throw new PricingSnapshotValidationError("TaxSummary tax line is invalid");
    const rate = line.rate;
    if (rate !== null && (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0)) throw new PricingSnapshotValidationError("TaxSummary tax line rate is invalid");
    return { title: line.title, amount: minor(line.amount, "TaxSummary.taxLines.amount")!, rate: rate as number | null };
  });
  return { taxesIncluded: summary.taxesIncluded, currency: summary.currency, subtotal, shipping, discounts, taxableAmount, taxLines, totalTax, totalPayable, source: "SHOPIFY" };
}

export function validateAuthoritativePricingSnapshot(input: AuthoritativePricingSnapshotInput): AuthoritativePricingSnapshotInput & { source: "SHOPIFY"; shopifyDraftOrderId: string | null; authoritativeAt: Date } {
  if (input.source !== "SHOPIFY") throw new PricingSnapshotValidationError("Pricing source must be SHOPIFY");
  if (!CURRENCY.test(input.currency)) throw new PricingSnapshotValidationError("Currency must be an uppercase three-letter code");
  const summary = parseTaxSummary(input.taxSummary);
  for (const [field, value] of Object.entries({ subtotalMinor: input.subtotalMinor, discountsMinor: input.discountsMinor, shippingMinor: input.shippingMinor, totalTaxMinor: input.totalTaxMinor, totalPayableMinor: input.totalPayableMinor })) minor(value, field);
  if (summary.currency !== input.currency) throw new PricingSnapshotValidationError("TaxSummary currency does not match snapshot currency");
  if (summary.totalPayable !== input.totalPayableMinor) throw new PricingSnapshotValidationError("TaxSummary total payable does not match snapshot total payable");
  if (summary.totalTax !== input.totalTaxMinor) throw new PricingSnapshotValidationError("TaxSummary total tax does not match snapshot total tax");
  if (summary.subtotal !== input.subtotalMinor || summary.shipping !== input.shippingMinor || summary.discounts !== input.discountsMinor || summary.taxesIncluded !== input.taxesIncluded) throw new PricingSnapshotValidationError("TaxSummary values do not match snapshot values");
  if (!PRICING_SNAPSHOT_REFRESH_REASONS.includes(input.refreshReason)) throw new PricingSnapshotValidationError("Refresh reason is invalid");
  const shopifyDraftOrderId = input.shopifyDraftOrderId?.trim() || null;
  if (shopifyDraftOrderId && !DRAFT_ORDER_GID.test(shopifyDraftOrderId)) throw new PricingSnapshotValidationError("Shopify Draft Order ID must be a canonical GID");
  const authoritativeAt = input.authoritativeAt ?? new Date();
  if (!(authoritativeAt instanceof Date) || !Number.isFinite(authoritativeAt.getTime())) throw new PricingSnapshotValidationError("Authoritative timestamp is invalid");
  return { ...input, source: "SHOPIFY", taxSummary: summary, shopifyDraftOrderId, authoritativeAt };
}
