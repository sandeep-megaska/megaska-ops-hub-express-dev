import assert from "node:assert/strict";
import test from "node:test";
import { addressInvalidationReason, cartSnapshotPricingFingerprint, checkoutDiscountFingerprint, checkoutShippingFingerprint } from "./pricing-mutation-fingerprints.ts";
import { invalidateAndOptionallyRefreshCheckoutPricing } from "./pricing-snapshot-orchestration.ts";

function lifecycle(options: { status?: "CURRENT" | "INVALIDATED"; refreshFails?: boolean; invalidationFails?: boolean; owned?: boolean } = {}) {
  const state = { invalidations: 0, refreshes: 0, audit: [] as Array<Record<string, unknown>>, status: options.status ?? "CURRENT", invalidatedAt: null as Date | null };
  const snapshot = () => ({ publicId: "snapshot-public", status: state.status, invalidatedAt: state.invalidatedAt });
  const snapshots = {
    getCheckoutPricingSnapshot: async () => snapshot(),
    invalidateCheckoutPricingSnapshot: async () => {
      if (options.invalidationFails) throw new Error("database unavailable");
      if (state.status === "CURRENT") { state.status = "INVALIDATED"; state.invalidatedAt = new Date("2026-07-20T10:00:00Z"); state.invalidations += 1; }
      return snapshot();
    },
  };
  const refresh = async () => { state.refreshes += 1; return options.refreshFails ? { ok: false as const, code: "shopify_unavailable" as const, retryable: true } : { ok: true as const, checkoutIntentPublicId: "intent-1", shopifyDraftOrderId: "draft-1", snapshotPublicId: "snapshot-current", taxSummary: {} as never, authoritativeAt: new Date(), reusedDraftOrder: false }; };
  return { state, dependencies: { snapshots: snapshots as never, refresh, ownsCheckout: async () => options.owned !== false, now: () => new Date("2026-07-20T10:00:00Z"), audit: (_event: string, data: Record<string, unknown>) => state.audit.push(data) } };
}

test("deferred cart lifecycle invalidates once and preserves the original invalidation timestamp", async () => {
  const h = lifecycle();
  const input = { shopId: "shop-1", checkoutIntentId: "intent-1", reason: "cart_changed" as const, refresh: false, refreshReason: "cart_confirmed" as const };
  assert.deepEqual(await invalidateAndOptionallyRefreshCheckoutPricing(input, h.dependencies), { ok: true, snapshotStatus: "INVALIDATED", refreshed: false, snapshotPublicId: "snapshot-public" });
  const first = h.state.invalidatedAt;
  await invalidateAndOptionallyRefreshCheckoutPricing(input, h.dependencies);
  assert.equal(h.state.invalidations, 1); assert.equal(h.state.invalidatedAt, first); assert.equal(h.state.refreshes, 0);
});

test("immediate refresh restores CURRENT and a failed refresh remains INVALIDATED", async () => {
  const success = lifecycle();
  assert.deepEqual(await invalidateAndOptionallyRefreshCheckoutPricing({ shopId: "shop-1", checkoutIntentId: "intent-1", reason: "province_changed", refresh: true, refreshReason: "address_confirmed" }, success.dependencies), { ok: true, snapshotStatus: "CURRENT", refreshed: true, snapshotPublicId: "snapshot-current" });
  const failure = lifecycle({ refreshFails: true });
  assert.deepEqual(await invalidateAndOptionallyRefreshCheckoutPricing({ shopId: "shop-1", checkoutIntentId: "intent-1", reason: "coupon_changed", refresh: true, refreshReason: "coupon_confirmed" }, failure.dependencies), { ok: false, code: "pricing_refresh_failed", retryable: true });
  assert.equal(failure.state.status, "INVALIDATED");
});

test("invalidation failure is operationally typed and wrong-shop ownership is rejected", async () => {
  const failed = lifecycle({ invalidationFails: true });
  assert.deepEqual(await invalidateAndOptionallyRefreshCheckoutPricing({ shopId: "shop-1", checkoutIntentId: "intent-1", reason: "cart_changed", refresh: false, refreshReason: "cart_confirmed" }, failed.dependencies), { ok: false, code: "pricing_invalidation_failed", retryable: true });
  const absent = lifecycle({ owned: false });
  absent.dependencies.snapshots.getCheckoutPricingSnapshot = async () => null as never;
  absent.dependencies.snapshots.invalidateCheckoutPricingSnapshot = async () => null as never;
  assert.deepEqual(await invalidateAndOptionallyRefreshCheckoutPricing({ shopId: "shop-2", checkoutIntentId: "intent-1", reason: "address_changed", refresh: true, refreshReason: "address_confirmed" }, absent.dependencies), { ok: false, code: "checkout_intent_not_found", retryable: false });
  assert.equal(absent.state.refreshes, 0);
});

test("cart fingerprint changes only for authoritative pricing fields", () => {
  const base = { items: [{ variant_id: 11, quantity: 1, title: "Old", image: "old.jpg", pricing_attributes: { engravingFee: "100" } }] };
  assert.equal(cartSnapshotPricingFingerprint(base), cartSnapshotPricingFingerprint({ items: [{ ...base.items[0], title: "New", image: "new.jpg", note: "gift" }] }));
  for (const changed of [{ variant_id: 12 }, { quantity: 2 }, { selling_plan_id: "plan-1" }, { pricing_attributes: { engravingFee: "200" } }]) assert.notEqual(cartSnapshotPricingFingerprint(base), cartSnapshotPricingFingerprint({ items: [{ ...base.items[0], ...changed }] }));
});

test("address reasons use country, province, postal, then generic precedence without PII", () => {
  const india = { countryCode: "IN", provinceCode: "KL", postalCode: "682001", city: "Kochi" };
  assert.equal(addressInvalidationReason(india, { ...india, countryCode: "AE", provinceCode: "DU" }), "country_changed");
  assert.equal(addressInvalidationReason(india, { ...india, provinceCode: "KA", postalCode: "560001" }), "province_changed");
  assert.equal(addressInvalidationReason(india, { ...india, postalCode: "682002" }), "postal_code_changed");
  assert.equal(addressInvalidationReason(india, { ...india, countryCode: " in ", provinceCode: "kl", city: "KOCHI" }), null);
});

test("shipping and coupons compare normalized pricing state", () => {
  const shipping = checkoutShippingFingerprint({ shippingAmountPaise: 0, currency: "inr" });
  assert.equal(shipping, checkoutShippingFingerprint({ shippingAmountPaise: 0, currency: "INR" }));
  assert.notEqual(shipping, checkoutShippingFingerprint({ shippingAmountPaise: 5000, currency: "INR" }));
  assert.notEqual(checkoutDiscountFingerprint([]), checkoutDiscountFingerprint([{ type: "MANUAL_CODE", code: "mega15" }]));
  assert.equal(checkoutDiscountFingerprint([{ type: "MANUAL_CODE", code: "mega15" }]), checkoutDiscountFingerprint([{ type: "MANUAL_CODE", code: " MEGA15 " }]));
});
