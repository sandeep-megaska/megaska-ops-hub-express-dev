import assert from "node:assert/strict";
import test from "node:test";
import { encryptShopifyToken } from "../shopify/token-crypto.ts";
import { resolveExpressCheckoutReadiness, toPublicExpressCheckoutConfig } from "./readiness.ts";

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = "readiness-test-key";
const configured = { enabled: true, environment: "test" as const, keyId: "rzp_test_key", keySecretEncrypted: encryptShopifyToken("secret"), webhookSecretEncrypted: null, currency: "INR", captureMode: "automatic" as const, upiEnabled: true, cardsEnabled: true, netBankingEnabled: true, walletsEnabled: true, codFallbackEnabled: true };

test("ready + razorpayReady when the toggle is on and Razorpay is valid", async () => {
  const ready = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => true, loadRazorpay: async () => configured, validateCredentials: async () => true });
  assert.equal(ready.ready, true);
  assert.equal(ready.codAvailable, true);
  assert.equal(ready.razorpayReady, true);
  assert.deepEqual(toPublicExpressCheckoutConfig(ready), { enabled: true, ready: true, codAvailable: true, razorpayReady: true, provider: "razorpay", fallback: "shopify_checkout" });
});

test("COD does not require Razorpay: enabled-but-no-Razorpay is ready and cod-available", async () => {
  const codOnly = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => true, loadRazorpay: async () => ({ ...configured, enabled: false, keyId: "", keySecretEncrypted: null }) });
  assert.equal(codOnly.ready, true, "the modal can open for COD with no payment provider");
  assert.equal(codOnly.codAvailable, true);
  assert.equal(codOnly.razorpayReady, false, "legacy in-app prepaid capture is not available");
  assert.equal(codOnly.reason, "razorpay_not_configured", "reason still diagnoses Razorpay");
});

test("disabled module is not ready and not cod-available", async () => {
  const disabled = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => false, loadRazorpay: async () => configured, validateCredentials: async () => true });
  assert.equal(disabled.ready, false);
  assert.equal(disabled.codAvailable, false);
  assert.equal(disabled.reason, "express_checkout_disabled");
});

test("razorpayReady is false (with a diagnostic reason) for invalid/undecryptable credentials, but COD still opens", async () => {
  const invalid = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => true, loadRazorpay: async () => configured, validateCredentials: async () => false });
  assert.equal(invalid.razorpayReady, false);
  assert.equal(invalid.ready, true);
  assert.equal(invalid.reason, "razorpay_invalid");
  const undecryptable = await resolveExpressCheckoutReadiness("shop-a", { loadEnabled: async () => true, loadRazorpay: async () => ({ ...configured, keySecretEncrypted: "v1:broken" }) });
  assert.equal(undecryptable.razorpayReady, false);
  assert.equal(undecryptable.reason, "razorpay_invalid");
});
