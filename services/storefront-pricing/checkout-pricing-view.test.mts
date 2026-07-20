import assert from "node:assert/strict";
import test from "node:test";
import { checkoutPricingView } from "./checkout-pricing-view.ts";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "database-id", publicId: "public-id", shopId: "shop-id", checkoutIntentId: "intent-id", shopifyDraftOrderId: "gid://shopify/DraftOrder/1",
    source: "SHOPIFY", status: "CURRENT", currency: "INR", subtotalMinor: 100000, discountsMinor: 10000, shippingMinor: 0,
    totalTaxMinor: 13729, totalPayableMinor: 90000, taxesIncluded: true,
    taxSummary: { source: "SHOPIFY", currency: "INR", subtotal: 100000, discounts: 10000, shipping: 0, taxableAmount: null, totalTax: 13729, totalPayable: 90000, taxesIncluded: true, taxLines: [{ title: "GST", amount: 13729, rate: .18 }] },
    cartFingerprint: "secret", addressFingerprint: null, shippingFingerprint: null, discountFingerprint: null, storeCreditFingerprint: null,
    refreshReason: "address_confirmed", invalidatedAt: null, invalidationReason: null, authoritativeAt: new Date("2026-07-20T12:00:00Z"), createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as any;
}

test("CURRENT snapshot maps to a customer-safe authoritative view without recalculating total", () => {
  const view = checkoutPricingView(snapshot());
  assert.equal(view.status, "CURRENT"); assert.equal(view.authoritative, true); assert.equal(view.totalPayableMinor, 90000);
  assert.deepEqual(view.taxLines, [{ title: "GST", amountMinor: 13729, rate: .18 }]);
  for (const internal of ["id", "publicId", "shopId", "checkoutIntentId", "shopifyDraftOrderId", "cartFingerprint"]) assert.equal(internal in view, false);
});

test("INVALIDATED snapshot retains continuity values but cannot be presented as authoritative", () => {
  const view = checkoutPricingView(snapshot({ status: "INVALIDATED", invalidationReason: "address_changed" }));
  assert.equal(view.status, "INVALIDATED"); assert.equal(view.authoritative, false); assert.equal(view.messageCode, "pricing_refresh_required"); assert.equal(view.totalPayableMinor, 90000);
});

test("missing and refreshing snapshots map to safe states", () => {
  assert.deepEqual(checkoutPricingView(null), { status: "UNAVAILABLE", authoritative: false, currency: null, subtotalMinor: null, discountsMinor: null, shippingMinor: null, totalTaxMinor: null, totalPayableMinor: null, taxesIncluded: null, taxLines: [], authoritativeAt: null, messageCode: "pricing_unavailable" });
  assert.equal(checkoutPricingView(snapshot(), { refreshing: true }).status, "REFRESHING");
});

test("mixed snapshot and tax-summary currencies are rejected", () => {
  const mixed = snapshot({ taxSummary: { ...snapshot().taxSummary, currency: "USD" } });
  assert.equal(checkoutPricingView(mixed).status, "UNAVAILABLE");
});
