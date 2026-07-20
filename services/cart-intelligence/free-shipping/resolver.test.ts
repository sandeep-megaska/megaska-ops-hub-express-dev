import test from "node:test";
import assert from "node:assert/strict";
import { resolveFreeShippingProgress, resolveShopifyFreeShipping } from "./resolver.ts";
import type { ShopifyFreeShippingAudit, ShopifyFreeShippingCandidate } from "./types.ts";

const candidate = (overrides: Partial<ShopifyFreeShippingCandidate> = {}): ShopifyFreeShippingCandidate => ({
  profileId: "profile-1", profileName: "General", broadlyApplicable: true, zoneCount: 1, active: true,
  providerType: "MERCHANT", priceAmount: "0.00", priceCurrency: "INR", conditionType: "MINIMUM_SUBTOTAL",
  conditionAmount: "1000.00", conditionCurrency: "INR", ...overrides,
});
const audit = (overrides: Partial<ShopifyFreeShippingAudit> = {}): ShopifyFreeShippingAudit => ({
  status: "AVAILABLE", thresholdMinor: 100000, currency: "INR", profileId: "profile-1", profileName: "General",
  profileCount: 1, applicableProfileCount: 1, reason: "detected", resolvedAt: new Date(0).toISOString(), ...overrides,
});
const view = (overrides: Partial<Parameters<typeof resolveFreeShippingProgress>[0]> = {}) => resolveFreeShippingProgress({
  enabled: true, progressEnabled: true, sourceMode: "SHOPIFY_ONLY", fallbackThresholdMinor: null,
  progressBarText: "You're {amount} away", currentSubtotalMinor: 50000, cartCurrency: "INR", shopify: audit(), ...overrides,
});

test("resolves one global zero-price rate with minimum subtotal", () => assert.equal(resolveShopifyFreeShipping({ candidates: [candidate()], profileCount: 1, cartCurrency: "INR" }).thresholdMinor, 100000));
test("threshold reached is unlocked", () => assert.deepEqual({ status: view({ currentSubtotalMinor: 100000 }).status, progress: view({ currentSubtotalMinor: 100000 }).progressPercent }, { status: "UNLOCKED", progress: 100 }));
test("below threshold includes remaining amount", () => assert.deepEqual({ status: view().status, remaining: view().remainingMinor }, { status: "AVAILABLE", remaining: 50000 }));
test("multiple profiles with the same threshold resolve", () => assert.equal(resolveShopifyFreeShipping({ candidates: [candidate(), candidate({ profileId: "profile-2" })], profileCount: 2, cartCurrency: "INR" }).status, "AVAILABLE"));
test("multiple conflicting thresholds are ambiguous", () => assert.equal(resolveShopifyFreeShipping({ candidates: [candidate(), candidate({ conditionAmount: "900.00" })], profileCount: 2, cartCurrency: "INR" }).status, "AMBIGUOUS"));
test("product-specific profile is ambiguous", () => assert.equal(resolveShopifyFreeShipping({ candidates: [candidate({ broadlyApplicable: false })], profileCount: 2, cartCurrency: "INR" }).status, "AMBIGUOUS"));
test("weight-only condition is unsupported", () => assert.equal(resolveShopifyFreeShipping({ candidates: [candidate({ conditionType: "WEIGHT" })], profileCount: 1, cartCurrency: "INR" }).status, "UNSUPPORTED"));
test("carrier-calculated rate is unsupported", () => assert.equal(resolveShopifyFreeShipping({ candidates: [candidate({ providerType: "CARRIER" })], profileCount: 1, cartCurrency: "INR" }).status, "UNSUPPORTED"));
test("currency mismatch is unsupported", () => assert.equal(resolveShopifyFreeShipping({ candidates: [candidate()], profileCount: 1, cartCurrency: "USD" }).status, "UNSUPPORTED"));
test("no free-shipping rule is not configured", () => assert.equal(resolveShopifyFreeShipping({ candidates: [candidate({ priceAmount: "10.00" })], profileCount: 1, cartCurrency: "INR" }).status, "NOT_CONFIGURED"));
test("merchant fallback is used only when enabled", () => assert.equal(view({ sourceMode: "SHOPIFY_WITH_FALLBACK", fallbackThresholdMinor: 75000, shopify: audit({ status: "NOT_CONFIGURED", thresholdMinor: null }) }).source, "MERCHANT_FALLBACK"));
test("Shopify-only mode hides without resolution", () => assert.equal(view({ fallbackThresholdMinor: 75000, shopify: audit({ status: "NOT_CONFIGURED", thresholdMinor: null }) }).visible, false));
test("malformed Shopify response is unsupported", () => assert.equal(resolveShopifyFreeShipping({ candidates: [], profileCount: 0, cartCurrency: "INR", malformed: true }).status, "UNSUPPORTED"));
test("runtime failure hides the bar without throwing", () => assert.equal(view({ shopify: audit({ status: "UNSUPPORTED", thresholdMinor: null }) }).visible, false));
test("ambiguous Shopify setup never silently falls back", () => assert.equal(view({ sourceMode: "SHOPIFY_WITH_FALLBACK", fallbackThresholdMinor: 75000, shopify: audit({ status: "AMBIGUOUS", thresholdMinor: null }) }).visible, false));
