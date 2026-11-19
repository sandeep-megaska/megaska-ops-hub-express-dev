import assert from "node:assert/strict";
import test from "node:test";
import { resolveExpressCheckoutReadiness, toPublicExpressCheckoutConfig } from "./readiness.ts";

const configured = { enabled: true, environment: "test" as const, keyId: "rzp_test_key", keySecretEncrypted: "v1:x:y:z", webhookSecretEncrypted: null, currency: "INR", captureMode: "automatic" as const, upiEnabled: true, cardsEnabled: true, netBankingEnabled: true, walletsEnabled: true, codFallbackEnabled: true };
const none = { ...configured, enabled: false, keyId: "", keySecretEncrypted: null };

test("the phone-verification switch alone decides readiness; no payment provider is needed", async () => {
  const on = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => true, loadRazorpay: async () => none });
  assert.equal(on.ready, true);
  assert.equal(on.codAvailable, true);
  assert.equal(on.reason, "ready");
  assert.deepEqual(toPublicExpressCheckoutConfig(on), { enabled: true, ready: true, codAvailable: true, provider: null, fallback: "shopify_checkout" });

  const off = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => false, loadRazorpay: async () => configured });
  assert.equal(off.ready, false);
  assert.equal(off.codAvailable, false);
  assert.equal(off.reason, "express_checkout_disabled");
});

test("provider is still reported for storefront scripts deployed before the change, without calling Razorpay", async () => {
  const legacy = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => true, loadRazorpay: async () => configured });
  assert.equal(legacy.provider, "razorpay");
  assert.equal(toPublicExpressCheckoutConfig(legacy).provider, "razorpay");
});
