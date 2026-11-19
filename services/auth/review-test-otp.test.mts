import assert from "node:assert/strict";
import test from "node:test";
import { __resetReviewTestOtpCacheForTests, reviewTestOtpConfig, reviewTestOtpFor } from "./review-test-otp.ts";
import { hashWhatsAppOtpCode, whatsAppOtpCodeMatches } from "./whatsapp-otp.ts";

const env = { REVIEW_OTP_PHONE: "+91 90000 00001", REVIEW_OTP_CODE: "246810" } as unknown as NodeJS.ProcessEnv;
const shop = { shopDomain: "loopd2c-review.myshopify.com" };

test("the test number is off unless both the phone and code are configured", () => {
  assert.equal(reviewTestOtpConfig({} as NodeJS.ProcessEnv), null);
  assert.equal(reviewTestOtpConfig({ REVIEW_OTP_PHONE: "+919000000001" } as unknown as NodeJS.ProcessEnv), null);
  assert.equal(reviewTestOtpConfig({ REVIEW_OTP_PHONE: "+919000000001", REVIEW_OTP_CODE: "12ab" } as unknown as NodeJS.ProcessEnv), null);
  assert.deepEqual(reviewTestOtpConfig(env), { phoneE164: "+919000000001", code: "246810" });
});

test("it applies only on development stores and only to the configured number", async () => {
  __resetReviewTestOtpCacheForTests();
  assert.deepEqual(await reviewTestOtpFor(shop, "+919000000001", { env, isDevStore: async () => true }), { phoneE164: "+919000000001", code: "246810" });
  assert.equal(await reviewTestOtpFor(shop, "+919000000002", { env, isDevStore: async () => true }), null, "any other number goes through normal OTP");
  __resetReviewTestOtpCacheForTests();
  assert.equal(await reviewTestOtpFor({ shopDomain: "live-store.myshopify.com" }, "+919000000001", { env, isDevStore: async () => false }), null, "a live store never accepts it");
  __resetReviewTestOtpCacheForTests();
  assert.equal(await reviewTestOtpFor(shop, "+919000000001", { env, isDevStore: async () => { throw new Error("Shopify down"); } }), null, "a failed lookup refuses it");
  assert.equal(await reviewTestOtpFor(shop, "+919000000001", { env: {} as NodeJS.ProcessEnv, isDevStore: async () => true }), null, "unconfigured");
});

test("the development-store answer is cached for ten minutes", async () => {
  __resetReviewTestOtpCacheForTests();
  let calls = 0;
  const isDevStore = async () => { calls += 1; return true; };
  await reviewTestOtpFor(shop, "+919000000001", { env, isDevStore, now: () => 0 });
  await reviewTestOtpFor(shop, "+919000000001", { env, isDevStore, now: () => 9 * 60 * 1000 });
  assert.equal(calls, 1);
  await reviewTestOtpFor(shop, "+919000000001", { env, isDevStore, now: () => 11 * 60 * 1000 });
  assert.equal(calls, 2);
});

test("the stored challenge verifies through the existing WhatsApp code check", () => {
  const hash = hashWhatsAppOtpCode("challenge-1", "246810");
  assert.equal(whatsAppOtpCodeMatches("challenge-1", "246810", hash), true);
  assert.equal(whatsAppOtpCodeMatches("challenge-1", "000000", hash), false);
});
