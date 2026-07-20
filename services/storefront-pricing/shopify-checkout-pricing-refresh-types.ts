import type { TaxSummary } from "./tax-summary.ts";
import type { PricingSnapshotRefreshReason } from "./pricing-snapshot-types.ts";

export type ShopifyPricingRefreshFailureCode =
  | "checkout_intent_not_found" | "checkout_intent_shop_mismatch"
  | "cart_snapshot_missing" | "cart_snapshot_invalid" | "address_missing"
  | "draft_order_create_failed" | "draft_order_update_failed"
  | "draft_order_response_invalid" | "draft_order_currency_missing"
  | "draft_order_pricing_invalid" | "pricing_snapshot_persist_failed"
  | "shopify_unavailable";

export type ShopifyCheckoutPricingRefreshResult =
  | { ok: true; checkoutIntentPublicId: string; shopifyDraftOrderId: string; snapshotPublicId: string; taxSummary: TaxSummary; authoritativeAt: Date; reusedDraftOrder: boolean }
  | { ok: false; code: ShopifyPricingRefreshFailureCode; retryable: boolean };

export type ShopifyCheckoutPricingRefreshInput = {
  shopId: string;
  checkoutIntentId: string;
  reason: PricingSnapshotRefreshReason;
};
