import assert from "node:assert/strict";
import test from "node:test";
import { encryptShopifyToken } from "../shopify/token-crypto.ts";
import { resolveExpressCheckoutReadiness, toPublicExpressCheckoutConfig } from "./readiness.ts";

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = "readiness-test-key";
const configured = { enabled: true, environment: "test" as const, keyId: "rzp_test_key", keySecretEncrypted: encryptShopifyToken("secret"), webhookSecretEncrypted: null, currency: "INR", captureMode: "automatic" as const, upiEnabled: true, cardsEnabled: true, netBankingEnabled: true, walletsEnabled: true, codFallbackEnabled: true };

test("readiness requires the merchant toggle and validated Razorpay credentials", async () => {
  const ready = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => true, loadRazorpay: async () => configured, validateCredentials: async () => true });
  assert.equal(ready.ready, true);
  assert.deepEqual(toPublicExpressCheckoutConfig(ready), { enabled: true, ready: true, provider: "razorpay", fallback: "shopify_checkout" });

  const disabled = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => false, loadRazorpay: async () => configured, validateCredentials: async () => true });
  assert.equal(disabled.reason, "express_checkout_disabled");
});

test("readiness fails closed for missing, invalid, and undecryptable credentials", async () => {
  const missing = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => true, loadRazorpay: async () => ({ ...configured, enabled: false, keyId: "", keySecretEncrypted: null }) });
  assert.equal(missing.reason, "razorpay_not_configured");
  const invalid = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => true, loadRazorpay: async () => configured, validateCredentials: async () => false });
  assert.equal(invalid.reason, "razorpay_invalid");
  const undecryptable = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => true, loadRazorpay: async () => ({ ...configured, keySecretEncrypted: "v1:broken" }) });
  assert.equal(undecryptable.reason, "razorpay_invalid");
});
