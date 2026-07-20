import { addressPricingFingerprint, cartPricingFingerprint, pricingInputFingerprint, type AddressPricingFingerprintInput, type CartFingerprintLine } from "./pricing-snapshot-fingerprint.ts";
import type { PricingSnapshotInvalidationReason } from "./pricing-snapshot-types.ts";

function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

export function cartSnapshotPricingFingerprint(snapshot: unknown) {
  const root = object(snapshot);
  const candidates = Array.isArray(snapshot) ? snapshot : root?.lineItems ?? root?.items ?? root?.lines;
  if (!Array.isArray(candidates)) return null;
  const lines: CartFingerprintLine[] = candidates.map((value): CartFingerprintLine | null => {
    const line = object(value); if (!line) return null;
    const variantId = String(line.variantId ?? line.shopifyVariantId ?? line.merchandiseId ?? line.variant_id ?? line.id ?? "").trim();
    const quantity = Number(line.quantity ?? line.qty);
    if (!variantId || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
    const sellingPlan = object(line.selling_plan_allocation);
    const sellingPlanId = String(line.sellingPlanId ?? line.selling_plan_id ?? object(sellingPlan?.selling_plan)?.id ?? "").trim() || null;
    const rawAttributes = object(line.pricingAttributes ?? line.pricing_attributes);
    const attributes = rawAttributes ? Object.fromEntries(Object.entries(rawAttributes).filter(([, item]) => typeof item === "string") as [string, string][]) : undefined;
    return { variantId, quantity, sellingPlanId, attributes } satisfies CartFingerprintLine;
  }).filter((line): line is CartFingerprintLine => line !== null);
  return lines.length ? cartPricingFingerprint(lines) : null;
}

export function checkoutShippingFingerprint(input: { shippingAmountPaise: number; currency: string; shippingMethodId?: string | null; shippingTitle?: string | null }) {
  return pricingInputFingerprint({ amountMinor: input.shippingAmountPaise, currency: input.currency.trim().toUpperCase(), shippingMethodId: input.shippingMethodId?.trim() || null, title: input.shippingTitle?.trim() || "Shipping" });
}

export function checkoutDiscountFingerprint(discounts: readonly { type: string; code?: string | null; rawShopifyPayload?: unknown }[]) {
  return pricingInputFingerprint(discounts.map((discount) => ({ type: discount.type, code: discount.code?.trim().toUpperCase() || null, rawShopifyPayload: discount.rawShopifyPayload ?? null })));
}

export function addressInvalidationReason(before: AddressPricingFingerprintInput | null, after: AddressPricingFingerprintInput): PricingSnapshotInvalidationReason | null {
  if (before && addressPricingFingerprint(before) === addressPricingFingerprint(after)) return null;
  if (!before || before.countryCode.trim().toUpperCase() !== after.countryCode.trim().toUpperCase()) return "country_changed";
  if ((before.provinceCode?.trim().toUpperCase() || null) !== (after.provinceCode?.trim().toUpperCase() || null)) return "province_changed";
  if ((before.postalCode?.trim().toUpperCase() || null) !== (after.postalCode?.trim().toUpperCase() || null)) return "postal_code_changed";
  return "address_changed";
}
