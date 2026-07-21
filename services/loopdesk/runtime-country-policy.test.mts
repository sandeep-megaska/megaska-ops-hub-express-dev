import test from "node:test";
import assert from "node:assert/strict";
import { getPublicOtpCountryPolicy } from "./otp-country-policy-runtime.ts";

test("runtime OTP country policy remains tenant scoped", async () => {
  const policies = new Map([
    ["shop-a", { defaultCountryCode: "IN", allowedCountryCodes: ["IN"] }],
    ["shop-b", { defaultCountryCode: "AE", allowedCountryCodes: ["AE", "KW"] }],
  ]);
  const load = async (shopId: string) => {
    const settings = policies.get(shopId);
    if (!settings) throw new Error("unexpected tenant");
    return settings;
  };
  const [shopA, shopB] = await Promise.all([
    getPublicOtpCountryPolicy("shop-a", load),
    getPublicOtpCountryPolicy("shop-b", load),
  ]);
  assert.equal(shopA.defaultCountryCode, "IN");
  assert.deepEqual(shopA.allowedCountries.map(({ iso2 }) => iso2), ["IN"]);
  assert.equal(shopB.defaultCountryCode, "AE");
  assert.deepEqual(shopB.allowedCountries.map(({ iso2 }) => iso2), ["AE", "KW"]);
});

test("runtime OTP policy lookup failures are isolated with an India fallback", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const policy = await getPublicOtpCountryPolicy("shop-a", async () => { throw new Error("database unavailable"); });
    assert.equal(policy.defaultCountryCode, "IN");
    assert.deepEqual(policy.allowedCountries.map(({ iso2 }) => iso2), ["IN"]);
  } finally {
    console.error = originalError;
  }
});
