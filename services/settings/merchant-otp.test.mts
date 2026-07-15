import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getMerchantOtpSettings, saveMerchantOtpSettings, getPlatformTwilioConfigurationStatus, type MerchantOtpSettingsDb } from "./merchant-otp.ts";

type Saved = { id: string; shopId: string; otpEnabled: boolean; providerMode: "PLATFORM_TWILIO" | "MERCHANT_TWILIO" | "MERCHANT_MSG91" | "MOCK"; allowPlatformFallback: boolean; twilioSettings: { status: "NOT_CONFIGURED" | "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "SUSPENDED" | "ERROR"; [key: string]: unknown } | null; msg91Settings: { status: "NOT_CONFIGURED" | "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "SUSPENDED" | "ERROR"; kycApproved: boolean; dltApproved: boolean; templateApproved: boolean; [key: string]: unknown } | null };
function db(seed: Saved[] = []): MerchantOtpSettingsDb & { settings: Map<string, Saved> } {
  const settings = new Map(seed.map((row) => [row.shopId, row]));
  return {
    settings,
    shop: { findUnique: async ({ where }) => where.id.startsWith("shop-") ? { id: where.id, shopDomain: `${where.id}.example` } : null },
    merchantOtpSettings: {
      findUnique: async ({ where }) => settings.get(where.shopId) || null,
      upsert: async ({ where, create, update }) => {
        const prior = settings.get(where.shopId);
        const next = prior ? { ...prior, ...update } : { id: `otp-${where.shopId}`, twilioSettings: null, msg91Settings: null, ...create };
        settings.set(where.shopId, next);
        return next;
      },
    },
  };
}

test("missing settings row returns platform Twilio defaults and does not create a row", async () => {
  const h = db();
  const resolved = await getMerchantOtpSettings("shop-1", h);
  assert.deepEqual(resolved, { shopId: "shop-1", otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, hasSettingsRow: false, merchantTwilioStatus: "NOT_CONFIGURED", merchantMsg91Status: "NOT_CONFIGURED" });
  assert.equal(h.settings.size, 0);
});

test("settings resolve only for requested shop", async () => {
  const h = db([{ id: "a", shopId: "shop-1", otpEnabled: false, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: false, twilioSettings: null, msg91Settings: null }, { id: "b", shopId: "shop-2", otpEnabled: true, providerMode: "MOCK", allowPlatformFallback: true, twilioSettings: null, msg91Settings: null }]);
  const resolved = await getMerchantOtpSettings("shop-1", h);
  assert.equal(resolved.shopId, "shop-1");
  assert.equal(resolved.otpEnabled, false);
  assert.equal(resolved.providerMode, "PLATFORM_TWILIO");
});

test("non-secret settings persist for the resolved shop", async () => {
  const h = db();
  await saveMerchantOtpSettings("shop-1", { otpEnabled: false, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: false }, h);
  const resolved = await getMerchantOtpSettings("shop-1", h);
  assert.equal(resolved.otpEnabled, false);
  assert.equal(resolved.allowPlatformFallback, false);
  assert.equal(resolved.providerMode, "PLATFORM_TWILIO");
});

test("unsupported provider mode is rejected", async () => {
  await assert.rejects(() => saveMerchantOtpSettings("shop-1", { otpEnabled: true, providerMode: "BAD", allowPlatformFallback: true }, db()), /not supported/);
});

test("mock provider is rejected in production", async () => {
  const old = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  await assert.rejects(() => saveMerchantOtpSettings("shop-1", { otpEnabled: true, providerMode: "MOCK", allowPlatformFallback: true }, db()), /Mock OTP provider/);
  (process.env as Record<string, string | undefined>).NODE_ENV = old;
});

test("merchant providers cannot activate without verification and approval gates", async () => {
  await assert.rejects(() => saveMerchantOtpSettings("shop-1", { otpEnabled: true, providerMode: "MERCHANT_TWILIO", allowPlatformFallback: true }, db()), /Merchant Twilio cannot be activated/);
  await assert.rejects(() => saveMerchantOtpSettings("shop-1", { otpEnabled: true, providerMode: "MERCHANT_MSG91", allowPlatformFallback: true }, db()), /Merchant MSG91 cannot be activated/);
});

test("one shop cannot modify another shop", async () => {
  const h = db([{ id: "a", shopId: "shop-1", otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, twilioSettings: null, msg91Settings: null }]);
  await saveMerchantOtpSettings("shop-2", { otpEnabled: false, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: false }, h);
  assert.equal(h.settings.get("shop-1")?.otpEnabled, true);
  assert.equal(h.settings.get("shop-2")?.otpEnabled, false);
});

test("unresolved shop is rejected", async () => {
  await assert.rejects(() => saveMerchantOtpSettings("missing", { otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true }, db()), /Unable to resolve/);
});

test("platform configuration status exposes booleans only", () => {
  const status = getPlatformTwilioConfigurationStatus({ TWILIO_ACCOUNT_SID: "ACsecret", TWILIO_AUTH_TOKEN: "token", TWILIO_VERIFY_SERVICE_SID: "VAsecret" } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(status, { configured: true, hasAccountSid: true, hasAuthToken: true, hasVerifyServiceSid: true });
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("resolver output contains no secret credential fields", async () => {
  const h = db([{ id: "a", shopId: "shop-1", otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, twilioSettings: { status: "NOT_CONFIGURED", authTokenEncrypted: "secret" }, msg91Settings: { status: "NOT_CONFIGURED", authKeyEncrypted: "secret", kycApproved: false, dltApproved: false, templateApproved: false } }]);
  const resolved = await getMerchantOtpSettings("shop-1", h);
  assert.equal(JSON.stringify(resolved).includes("secret"), false);
  assert.equal("authTokenEncrypted" in resolved, false);
});

test("existing OTP provider signatures remain unchanged", () => {
  const source = readFileSync(new URL("../auth/otp.ts", import.meta.url), "utf8");
  assert.match(source, /export async function sendOtpWithTwilio\(phoneE164: string\)/);
  assert.match(source, /export async function verifyOtpWithTwilio\(phoneE164: string, otpCode: string\)/);
  assert.match(source, /export async function sendOtpWithMsg91\(phoneE164: string\)/);
  assert.match(source, /export async function verifyOtpWithMsg91\(phoneE164: string, otpCode: string\)/);
  assert.match(source, /export function getOtpProvider\(\)/);
  assert.match(source, /export function getOtpProviderFallbackOrder\(\)/);
});
