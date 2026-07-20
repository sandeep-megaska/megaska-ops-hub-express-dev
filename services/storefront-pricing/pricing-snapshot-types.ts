import type { TaxSummary } from "./tax-summary.ts";

export const PRICING_SNAPSHOT_INVALIDATION_REASONS = [
  "cart_changed", "address_changed", "country_changed", "province_changed", "postal_code_changed",
  "shipping_method_changed", "coupon_changed", "promotion_changed", "payment_method_changed",
  "store_credit_changed", "draft_order_changed", "manual_invalidation",
] as const;
export type PricingSnapshotInvalidationReason = (typeof PRICING_SNAPSHOT_INVALIDATION_REASONS)[number];

export const PRICING_SNAPSHOT_REFRESH_REASONS = [
  "checkout_initialized", "cart_confirmed", "address_confirmed", "shipping_confirmed", "coupon_confirmed",
  "promotion_confirmed", "store_credit_confirmed", "payment_preparation", "manual_refresh",
] as const;
export type PricingSnapshotRefreshReason = (typeof PRICING_SNAPSHOT_REFRESH_REASONS)[number];

export type PricingSnapshotStatus = "CURRENT" | "INVALIDATED";
export type ShopifyCheckoutPricingSnapshot = {
  id: string; publicId: string; shopId: string; checkoutIntentId: string; shopifyDraftOrderId: string | null;
  source: "SHOPIFY"; status: PricingSnapshotStatus; currency: string | null;
  subtotalMinor: number | null; discountsMinor: number | null; shippingMinor: number | null;
  totalTaxMinor: number | null; totalPayableMinor: number | null; taxesIncluded: boolean | null;
  taxSummary: TaxSummary | null; cartFingerprint: string | null; addressFingerprint: string | null;
  shippingFingerprint: string | null; discountFingerprint: string | null; storeCreditFingerprint: string | null;
  refreshReason: PricingSnapshotRefreshReason | null; invalidatedAt: Date | null;
  invalidationReason: PricingSnapshotInvalidationReason | null; authoritativeAt: Date | null;
  createdAt: Date; updatedAt: Date;
};

export type AuthoritativePricingSnapshotInput = {
  source: string; shopifyDraftOrderId?: string | null; currency: string;
  subtotalMinor: number; discountsMinor: number; shippingMinor: number; totalTaxMinor: number; totalPayableMinor: number;
  taxesIncluded: boolean; taxSummary: TaxSummary; refreshReason: PricingSnapshotRefreshReason;
  cartFingerprint?: string | null; addressFingerprint?: string | null; shippingFingerprint?: string | null;
  discountFingerprint?: string | null; storeCreditFingerprint?: string | null; authoritativeAt?: Date;
};
