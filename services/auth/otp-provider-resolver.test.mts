import assert from "node:assert/strict";
import test from "node:test";
import { resolveOtpProviderForShop } from "./otp-provider-resolver.ts";

type Saved = {
  id: string;
  shopId: string;
  otpEnabled: boolean;
  providerMode: "PLATFORM_TWILIO" | "MERCHANT_TWILIO" | "MERCHANT_MSG91" | "MOCK";
  allowPlatformFallback: boolean;
  twilioSettings: { status: "NOT_CONFIGURED" | "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "SUSPENDED" | "ERROR" } | null;
  msg91Settings: { status: "NOT_CONFIGURED" | "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "SUSPENDED" | "ERROR"; kycApproved: boolean; dltApproved: boolean; templateApproved: boolean } | null;
};

function db(rows: Saved[] = [], shopIds = ["shop-1", "shop-2"]) {
  const settings = new Map(rows.map((row) => [row.shopId, row]));
  return {
    shop: { findUnique: async ({ where }: { where: { id: string } }) => shopIds.includes(where.id) ? { id: where.id, shopDomain: `${where.id}.myshopify.com` } : null },
    merchantOtpSettings: {
      findUnique: async ({ where }: { where: { shopId: string } }) => settings.get(where.shopId) ?? null,
      upsert: async () => { throw new Error("not needed"); },
    },
  } as unknown as import("../settings/merchant-otp.ts").MerchantOtpSettingsDb;
}

const configuredEnv = { TWILIO_ACCOUNT_SID: "sid", TWILIO_AUTH_TOKEN: "token", TWILIO_VERIFY_SERVICE_SID: "verify", NODE_ENV: "test" } as NodeJS.ProcessEnv;
const missingEnv = { NODE_ENV: "test" } as NodeJS.ProcessEnv;

function row(input: Partial<Saved> & { shopId?: string; providerMode?: Saved["providerMode"] } = {}): Saved {
  return { id: `otp-${input.shopId ?? "shop-1"}`, shopId: input.shopId ?? "shop-1", otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, twilioSettings: null, msg91Settings: null, ...input };
}

test("missing settings row resolves platform Twilio", async () => {
  const result = await resolveOtpProviderForShop("shop-1", { db: db(), env: configuredEnv });
  assert.deepEqual(result, { available: true, shopId: "shop-1", provider: "PLATFORM_TWILIO", transportProvider: "twilio", usedFallback: false, settingsSource: "DEFAULTS" });
});

test("saved platform Twilio setting resolves platform Twilio", async () => {
  const result = await resolveOtpProviderForShop("shop-1", { db: db([row()]), env: configuredEnv });
  assert.equal(result.available, true);
  if (result.available) assert.equal(result.settingsSource, "MERCHANT_SETTINGS");
});

test("otpEnabled false prevents OTP sending", async () => {
  const result = await resolveOtpProviderForShop("shop-1", { db: db([row({ otpEnabled: false })]), env: configuredEnv });
  assert.deepEqual(result, { available: false, shopId: "shop-1", reason: "OTP_DISABLED" });
});

test("platform Twilio missing configuration returns unavailable", async () => {
  const result = await resolveOtpProviderForShop("shop-1", { db: db([row()]), env: missingEnv });
  assert.deepEqual(result, { available: false, shopId: "shop-1", reason: "PLATFORM_TWILIO_NOT_CONFIGURED" });
});

test("shop A settings do not affect shop B defaults", async () => {
  const result = await resolveOtpProviderForShop("shop-2", { db: db([row({ shopId: "shop-1", otpEnabled: false })]), env: configuredEnv });
  assert.equal(result.available, true);
});

test("merchant Twilio inactive with fallback enabled uses platform Twilio", async () => {
  const result = await resolveOtpProviderForShop("shop-1", { db: db([row({ providerMode: "MERCHANT_TWILIO", allowPlatformFallback: true })]), env: configuredEnv });
  assert.equal(result.available, true);
  if (result.available) assert.equal(result.usedFallback, true);
});

test("merchant Twilio inactive with fallback disabled is unavailable", async () => {
  const result = await resolveOtpProviderForShop("shop-1", { db: db([row({ providerMode: "MERCHANT_TWILIO", allowPlatformFallback: false })]), env: configuredEnv });
  assert.deepEqual(result, { available: false, shopId: "shop-1", reason: "FALLBACK_DISABLED" });
});

test("merchant MSG91 inactive with fallback enabled uses platform Twilio", async () => {
  const result = await resolveOtpProviderForShop("shop-1", { db: db([row({ providerMode: "MERCHANT_MSG91" })]), env: configuredEnv });
  assert.equal(result.available, true);
  if (result.available) assert.equal(result.usedFallback, true);
});

test("mock is rejected in production without fallback", async () => {
  const result = await resolveOtpProviderForShop("shop-1", { db: db([row({ providerMode: "MOCK", allowPlatformFallback: false })]), env: { ...configuredEnv, NODE_ENV: "production" } });
  assert.deepEqual(result, { available: false, shopId: "shop-1", reason: "FALLBACK_DISABLED" });
});
