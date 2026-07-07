import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeRazorpayConfig,
  normalizeRazorpayConfig,
  RAZORPAY_MASKED_SECRET,
  toRazorpayAdminConfig,
  toRazorpayPublicRuntimeConfig,
  validateRazorpayConfigPatch,
} from "./config.ts";

test("normalizes Razorpay defaults", () => {
  const config = normalizeRazorpayConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.environment, "test");
  assert.equal(config.currency, "INR");
  assert.equal(config.captureMode, "automatic");
  assert.equal(config.upiEnabled, true);
});

test("admin config masks secrets", () => {
  const config = normalizeRazorpayConfig({
    keySecretEncrypted: "encrypted-key-secret",
    webhookSecretEncrypted: "encrypted-webhook-secret",
  });
  const admin = toRazorpayAdminConfig(config) as Record<string, unknown>;
  assert.equal(admin.keySecretMasked, RAZORPAY_MASKED_SECRET);
  assert.equal(admin.webhookSecretMasked, RAZORPAY_MASKED_SECRET);
  assert.equal(admin.keySecretEncrypted, undefined);
  assert.equal(admin.webhookSecretEncrypted, undefined);
});

test("public runtime excludes Razorpay secrets and capture mode", () => {
  const config = normalizeRazorpayConfig({
    enabled: true,
    keyId: "rzp_test_123",
    keySecretEncrypted: "encrypted-key-secret",
    webhookSecretEncrypted: "encrypted-webhook-secret",
    captureMode: "manual",
  });
  const runtime = toRazorpayPublicRuntimeConfig(config) as Record<string, unknown>;
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.keyId, "rzp_test_123");
  assert.equal(runtime.keySecretEncrypted, undefined);
  assert.equal(runtime.webhookSecretEncrypted, undefined);
  assert.equal(runtime.keySecret, undefined);
  assert.equal(runtime.webhookSecret, undefined);
  assert.equal(runtime.captureMode, undefined);
});

test("masked secret submissions preserve existing encrypted secrets", () => {
  const current = normalizeRazorpayConfig({ keySecretEncrypted: "existing" });
  const merged = mergeRazorpayConfig(current, { keySecret: RAZORPAY_MASKED_SECRET });
  assert.equal(merged.keySecretEncrypted, "existing");
});

test("validates Razorpay config patch fields", () => {
  const errors = validateRazorpayConfigPatch({
    environment: "live",
    captureMode: "later",
    currency: "Rupees",
    enabled: "yes",
  });
  assert.match(errors.join(" "), /environment/);
  assert.match(errors.join(" "), /capture mode/);
  assert.match(errors.join(" "), /Currency/);
  assert.match(errors.join(" "), /Razorpay enabled/);
});
