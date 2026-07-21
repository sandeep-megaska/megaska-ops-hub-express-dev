import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedMerchantOtpSettings } from "../settings/merchant-otp.ts";
import {
  normalizeOtpPhoneForVerification,
  OtpPhonePolicyError,
  resolveOtpPhoneForShop,
} from "./otp-phone-policy.ts";

function settings(
  shopId: string,
  allowedCountryCodes: string[],
  hasSettingsRow = true,
): ResolvedMerchantOtpSettings {
  return {
    shopId,
    otpEnabled: true,
    providerMode: "PLATFORM_TWILIO",
    allowPlatformFallback: true,
    defaultCountryCode: "IN",
    allowedCountryCodes,
    hasSettingsRow,
    merchantTwilioStatus: "NOT_CONFIGURED",
    merchantMsg91Status: "NOT_CONFIGURED",
  };
}

function loader(policies: Record<string, string[]>) {
  return async (shopId: string) => settings(shopId, policies[shopId] ?? ["IN"]);
}

async function expectPolicyError(
  promise: Promise<unknown>,
  code: OtpPhonePolicyError["code"],
  status: OtpPhonePolicyError["status"],
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OtpPhonePolicyError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test("legacy and explicit India requests preserve the India corridor", async () => {
  const getSettings = loader({ india: ["IN"] });
  assert.deepEqual(
    await resolveOtpPhoneForShop(
      { shopId: "india", phone: "9876543210" },
      { getSettings },
    ),
    { phoneE164: "+919876543210", countryCode: "IN" },
  );
  assert.deepEqual(
    await resolveOtpPhoneForShop(
      { shopId: "india", phone: "9876543210", countryCode: "in" },
      { getSettings },
    ),
    { phoneE164: "+919876543210", countryCode: "IN" },
  );
});

test("allowed UAE and Kuwait requests produce canonical E.164", async () => {
  const getSettings = loader({ global: ["IN", "AE", "KW"] });
  assert.deepEqual(
    await resolveOtpPhoneForShop(
      { shopId: "global", phone: "0501234567", countryCode: "AE" },
      { getSettings },
    ),
    { phoneE164: "+971501234567", countryCode: "AE" },
  );
  assert.deepEqual(
    await resolveOtpPhoneForShop(
      { shopId: "global", phone: "5000 0000", countryCode: "kw" },
      { getSettings },
    ),
    { phoneE164: "+96550000000", countryCode: "KW" },
  );
});

test("request authorization rejects countries outside the merchant policy", async () => {
  await expectPolicyError(
    resolveOtpPhoneForShop(
      { shopId: "india", phone: "0501234567", countryCode: "AE" },
      { getSettings: loader({ india: ["IN"] }) },
    ),
    "COUNTRY_NOT_ALLOWED",
    403,
  );
});

test("omitted country defaults only to India and never infers UAE", async () => {
  await expectPolicyError(
    resolveOtpPhoneForShop(
      { shopId: "global", phone: "+971501234567" },
      { getSettings: loader({ global: ["IN", "AE"] }) },
    ),
    "INVALID_PHONE",
    400,
  );
});

test("missing phone, invalid country, and invalid phone have stable failures", async () => {
  const getSettings = loader({ global: ["IN", "AE"] });
  await expectPolicyError(
    resolveOtpPhoneForShop({ shopId: "global", phone: "" }, { getSettings }),
    "PHONE_REQUIRED",
    400,
  );
  for (const countryCode of ["", "UAE", "ZZ", 971]) {
    await expectPolicyError(
      resolveOtpPhoneForShop(
        { shopId: "global", phone: "0501234567", countryCode },
        { getSettings },
      ),
      "INVALID_COUNTRY",
      400,
    );
  }
  await expectPolicyError(
    resolveOtpPhoneForShop(
      { shopId: "global", phone: "123", countryCode: "AE" },
      { getSettings },
    ),
    "INVALID_PHONE",
    400,
  );
});

test("merchant policies are tenant isolated", async () => {
  const getSettings = loader({ shopA: ["IN"], shopB: ["AE"] });
  const input = { phone: "0501234567", countryCode: "AE" };
  await expectPolicyError(
    resolveOtpPhoneForShop({ shopId: "shopA", ...input }, { getSettings }),
    "COUNTRY_NOT_ALLOWED",
    403,
  );
  assert.deepEqual(
    await resolveOtpPhoneForShop({ shopId: "shopB", ...input }, { getSettings }),
    { phoneE164: "+971501234567", countryCode: "AE" },
  );
});

test("verification normalizes without consulting a changed allow-list", async () => {
  assert.deepEqual(
    await normalizeOtpPhoneForVerification({
      shopId: "shop-changed-to-india",
      phone: "0501234567",
      countryCode: "AE",
    }),
    { phoneE164: "+971501234567", countryCode: "AE" },
  );
});

test("settings-service India defaults keep merchants without a row functional", async () => {
  const defaultSettings = settings("legacy", ["IN"], false);
  assert.deepEqual(
    await resolveOtpPhoneForShop(
      { shopId: "legacy", phone: "9876543210" },
      { getSettings: async () => defaultSettings },
    ),
    { phoneE164: "+919876543210", countryCode: "IN" },
  );
});
