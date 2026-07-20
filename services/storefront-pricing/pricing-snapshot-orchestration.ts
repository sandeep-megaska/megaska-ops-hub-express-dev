import { CheckoutPricingSnapshotService } from "./pricing-snapshot-service.ts";
import { refreshShopifyCheckoutPricing } from "./shopify-checkout-pricing-refresh.ts";
import { prisma } from "../db/prisma.ts";
import type { PricingSnapshotInvalidationReason, PricingSnapshotRefreshReason } from "./pricing-snapshot-types.ts";

export type PricingMutationResult =
  | { ok: true; snapshotStatus: "CURRENT" | "INVALIDATED"; refreshed: boolean; snapshotPublicId: string | null }
  | { ok: false; code: "pricing_invalidation_failed" | "pricing_refresh_failed" | "checkout_intent_not_found" | "checkout_shop_mismatch"; retryable: boolean };

type Dependencies = {
  snapshots?: Pick<CheckoutPricingSnapshotService, "getCheckoutPricingSnapshot" | "invalidateCheckoutPricingSnapshot">;
  refresh?: typeof refreshShopifyCheckoutPricing;
  now?: () => Date;
  audit?: (event: string, data: Record<string, unknown>) => void;
  ownsCheckout?: (input: { shopId: string; checkoutIntentId: string }) => Promise<boolean>;
};

export async function invalidateAndOptionallyRefreshCheckoutPricing(input: {
  shopId: string;
  checkoutIntentId: string;
  reason: PricingSnapshotInvalidationReason;
  refresh: boolean;
  refreshReason: PricingSnapshotRefreshReason;
}, dependencies: Dependencies = {}): Promise<PricingMutationResult> {
  const snapshots = dependencies.snapshots ?? new CheckoutPricingSnapshotService();
  const refresh = dependencies.refresh ?? refreshShopifyCheckoutPricing;
  const timestamp = dependencies.now?.() ?? new Date();
  const audit = dependencies.audit ?? ((event, data) => console.info("[CHECKOUT PRICING LIFECYCLE]", event, data));
  let previous;
  let invalidated;
  try {
    previous = await snapshots.getCheckoutPricingSnapshot({ shopId: input.shopId, checkoutIntentId: input.checkoutIntentId });
    invalidated = await snapshots.invalidateCheckoutPricingSnapshot({ shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, reason: input.reason, invalidatedAt: timestamp });
  } catch {
    audit("invalidation_failed", { shopId: input.shopId, checkoutIntentPublicId: input.checkoutIntentId, mutationCategory: input.reason, invalidationReason: input.reason, previousSnapshotStatus: previous?.status ?? null, resultingSnapshotStatus: "UNKNOWN", refreshAttempted: false, refreshSucceeded: false, failureCode: "pricing_invalidation_failed", timestamp: timestamp.toISOString() });
    return { ok: false, code: "pricing_invalidation_failed", retryable: true };
  }

  const database = prisma as unknown as { expressCheckoutIntent: { findFirst(args: object): Promise<{ id: string } | null> } };
  const ownsCheckout = dependencies.ownsCheckout ?? (async (owned) => Boolean(await database.expressCheckoutIntent.findFirst({ where: { id: owned.checkoutIntentId, shopId: owned.shopId }, select: { id: true } })));
  if (!previous && !invalidated && !(await ownsCheckout(input))) {
    audit("invalidation_rejected", { shopId: input.shopId, checkoutIntentPublicId: input.checkoutIntentId, mutationCategory: input.reason, invalidationReason: input.reason, previousSnapshotStatus: null, resultingSnapshotStatus: null, refreshAttempted: false, refreshSucceeded: false, failureCode: "checkout_intent_not_found", timestamp: timestamp.toISOString() });
    return { ok: false, code: "checkout_intent_not_found", retryable: false };
  }
  if (!input.refresh) {
    audit("invalidated", { shopId: input.shopId, checkoutIntentPublicId: input.checkoutIntentId, mutationCategory: input.reason, invalidationReason: input.reason, previousSnapshotStatus: previous?.status ?? null, resultingSnapshotStatus: invalidated?.status ?? "INVALIDATED", refreshAttempted: false, refreshSucceeded: false, failureCode: null, timestamp: timestamp.toISOString() });
    return { ok: true, snapshotStatus: "INVALIDATED", refreshed: false, snapshotPublicId: invalidated?.publicId ?? previous?.publicId ?? null };
  }

  const refreshed = await refresh({ shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, reason: input.refreshReason });
  if (!refreshed.ok) {
    const code = refreshed.code === "checkout_intent_not_found" ? "checkout_intent_not_found" : refreshed.code === "checkout_intent_shop_mismatch" ? "checkout_shop_mismatch" : "pricing_refresh_failed";
    audit("refresh_failed", { shopId: input.shopId, checkoutIntentPublicId: input.checkoutIntentId, mutationCategory: input.reason, invalidationReason: input.reason, previousSnapshotStatus: previous?.status ?? null, resultingSnapshotStatus: "INVALIDATED", refreshAttempted: true, refreshSucceeded: false, failureCode: code, timestamp: timestamp.toISOString() });
    return { ok: false, code, retryable: refreshed.retryable };
  }
  audit("refresh_succeeded", { shopId: input.shopId, checkoutIntentPublicId: input.checkoutIntentId, mutationCategory: input.reason, invalidationReason: input.reason, previousSnapshotStatus: previous?.status ?? null, resultingSnapshotStatus: "CURRENT", refreshAttempted: true, refreshSucceeded: true, failureCode: null, timestamp: timestamp.toISOString() });
  return { ok: true, snapshotStatus: "CURRENT", refreshed: true, snapshotPublicId: refreshed.snapshotPublicId };
}
