import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getMerchantOtpSettings, saveMerchantOtpSettings, getPlatformTwilioConfigurationStatus, MerchantOtpSettingsValidationError, type MerchantOtpSettingsDb } from "./merchant-otp.ts";

type Saved = { id: string; shopId: string; otpEnabled: boolean; providerMode: "PLATFORM_TWILIO" | "MERCHANT_TWILIO" | "MERCHANT_MSG91" | "MOCK"; allowPlatformFallback: boolean; defaultCountryCode?: string; allowedCountryCodes?: string[]; twilioSettings: { status: "NOT_CONFIGURED" | "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "SUSPENDED" | "ERROR"; [key: string]: unknown } | null; msg91Settings: { status: "NOT_CONFIGURED" | "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "SUSPENDED" | "ERROR"; kycApproved: boolean; dltApproved: boolean; templateApproved: boolean; [key: string]: unknown } | null };
function db(seed: Saved[] = []): MerchantOtpSettingsDb & { settings: Map<string, Saved> } {
  const settings = new Map(seed.map((row) => [row.shopId, row]));
  return {
    settings,
    shop: { findUnique: async ({ where }) => where.id.startsWith("shop-") ? { id: where.id, shopDomain: `${where.id}.example` } : null },
    merchantOtpSettings: {
      findUnique: async ({ where }) => settings.get(where.shopId) as Awaited<ReturnType<MerchantOtpSettingsDb["merchantOtpSettings"]["findUnique"]>> || null,
      upsert: async ({ where, create, update }) => {
        const prior = settings.get(where.shopId);
        const next = prior ? { ...prior, ...update } : { id: `otp-${where.shopId}`, twilioSettings: null, msg91Settings: null, ...create };
        settings.set(where.shopId, next);
        return next as Awaited<ReturnType<MerchantOtpSettingsDb["merchantOtpSettings"]["upsert"]>>;
      },
    },
  };
}

test("missing settings row returns platform Twilio defaults and does not create a row", async () => {
  const h = db();
  const resolved = await getMerchantOtpSettings("shop-1", h);
  assert.deepEqual(resolved, { shopId: "shop-1", otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, defaultCountryCode: "IN", allowedCountryCodes: ["IN"], hasSettingsRow: false, merchantTwilioStatus: "NOT_CONFIGURED", merchantMsg91Status: "NOT_CONFIGURED" });
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
  assert.equal(resolved.defaultCountryCode, "IN");
  assert.deepEqual(resolved.allowedCountryCodes, ["IN"]);
});

test("an omitted country policy preserves an existing row's policy", async () => {
  const h = db([{ id: "a", shopId: "shop-1", otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, defaultCountryCode: "AE", allowedCountryCodes: ["AE", "IN"], twilioSettings: null, msg91Settings: null }]);
  const resolved = await saveMerchantOtpSettings("shop-1", { otpEnabled: false, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: false }, h);
  assert.equal(resolved.defaultCountryCode, "AE");
  assert.deepEqual(resolved.allowedCountryCodes, ["AE", "IN"]);
});

test("explicit single-country policy is normalized", async () => {
  const resolved = await saveMerchantOtpSettings("shop-1", { otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, defaultCountryCode: "in", allowedCountryCodes: ["in"] }, db());
  assert.equal(resolved.defaultCountryCode, "IN");
  assert.deepEqual(resolved.allowedCountryCodes, ["IN"]);
});

test("explicit multi-country policy is normalized", async () => {
  const resolved = await saveMerchantOtpSettings("shop-1", { otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, defaultCountryCode: "ae", allowedCountryCodes: ["in", "AE", "us"] }, db());
  assert.equal(resolved.defaultCountryCode, "AE");
  assert.deepEqual(resolved.allowedCountryCodes, ["IN", "AE", "US"]);
});

test("duplicate allowed countries are removed after normalization", async () => {
  const resolved = await saveMerchantOtpSettings("shop-1", { otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, defaultCountryCode: "in", allowedCountryCodes: ["in", "IN", "ae", "AE"] }, db());
  assert.deepEqual(resolved.allowedCountryCodes, ["IN", "AE"]);
});

test("invalid allowed-country inputs are rejected", async () => {
  for (const allowedCountryCodes of [[], "IN", { country: "IN" }, null, ["IND"], ["+91"], ["I1"], [91], Array.from({ length: 251 }, () => "IN")]) {
    await assert.rejects(() => saveMerchantOtpSettings("shop-1", { otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, defaultCountryCode: "IN", allowedCountryCodes }, db()), MerchantOtpSettingsValidationError);
  }
});

test("invalid default countries and defaults outside the allowed list are rejected", async () => {
  for (const defaultCountryCode of ["", "IND", "I", "91", "+91", "I1", "   "]) {
    await assert.rejects(() => saveMerchantOtpSettings("shop-1", { otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, defaultCountryCode, allowedCountryCodes: ["IN"] }, db()), MerchantOtpSettingsValidationError);
  }
  await assert.rejects(() => saveMerchantOtpSettings("shop-1", { otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, defaultCountryCode: "US", allowedCountryCodes: ["IN", "AE"] }, db()), /included in allowed countries/);
});

test("malformed legacy country policy resolves to India-only", async () => {
  const h = db([{ id: "a", shopId: "shop-1", otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, defaultCountryCode: "IND", allowedCountryCodes: [], twilioSettings: null, msg91Settings: null }]);
  const resolved = await getMerchantOtpSettings("shop-1", h);
  assert.equal(resolved.defaultCountryCode, "IN");
  assert.deepEqual(resolved.allowedCountryCodes, ["IN"]);
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
  const h = db([{ id: "a", shopId: "shop-1", otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, defaultCountryCode: "AE", allowedCountryCodes: ["AE", "IN"], twilioSettings: null, msg91Settings: null }]);
  await saveMerchantOtpSettings("shop-2", { otpEnabled: false, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: false, defaultCountryCode: "US", allowedCountryCodes: ["US"] }, h);
  assert.equal(h.settings.get("shop-1")?.otpEnabled, true);
  assert.equal(h.settings.get("shop-1")?.defaultCountryCode, "AE");
  assert.deepEqual(h.settings.get("shop-1")?.allowedCountryCodes, ["AE", "IN"]);
  assert.equal(h.settings.get("shop-2")?.otpEnabled, false);
  assert.equal(h.settings.get("shop-2")?.defaultCountryCode, "US");
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
