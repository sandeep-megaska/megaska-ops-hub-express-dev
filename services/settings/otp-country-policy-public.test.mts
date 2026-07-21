import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicOtpCountryPolicy } from "./otp-country-policy-public.ts";

test("builds the India-only public policy", () => {
  assert.deepEqual(buildPublicOtpCountryPolicy({ defaultCountryCode: "IN", allowedCountryCodes: ["IN"] }), {
    defaultCountryCode: "IN",
    allowedCountries: [{ iso2: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" }],
  });
});

test("preserves configured order and retains a valid default", () => {
  const policy = buildPublicOtpCountryPolicy({ defaultCountryCode: "AE", allowedCountryCodes: ["IN", "AE", "KW"] });
  assert.equal(policy.defaultCountryCode, "AE");
  assert.deepEqual(policy.allowedCountries, [
    { iso2: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" },
    { iso2: "AE", name: "United Arab Emirates", dialCode: "+971", flag: "🇦🇪" },
    { iso2: "KW", name: "Kuwait", dialCode: "+965", flag: "🇰🇼" },
  ]);
});

test("deduplicates country codes defensively", () => {
  const policy = buildPublicOtpCountryPolicy({ defaultCountryCode: "AE", allowedCountryCodes: ["AE", "AE", "IN", "AE"] });
  assert.deepEqual(policy.allowedCountries.map(({ iso2 }) => iso2), ["AE", "IN"]);
});

test("filters unknown countries and chooses the first known default", () => {
  const unknown: string[] = [];
  const policy = buildPublicOtpCountryPolicy({ defaultCountryCode: "ZZ", allowedCountryCodes: ["ZZ", "AE", "IN"], onUnknownCountryCode: (code) => unknown.push(code) });
  assert.equal(policy.defaultCountryCode, "AE");
  assert.deepEqual(policy.allowedCountries.map(({ iso2 }) => iso2), ["AE", "IN"]);
  assert.deepEqual(unknown, ["ZZ"]);
});

test("falls back to India for all-unknown and empty policies", () => {
  assert.deepEqual(
    buildPublicOtpCountryPolicy({ defaultCountryCode: "ZZ", allowedCountryCodes: ["ZZ", "XY"] }),
    buildPublicOtpCountryPolicy({ defaultCountryCode: "ZZ", allowedCountryCodes: [] }),
  );
  assert.equal(buildPublicOtpCountryPolicy({ defaultCountryCode: "ZZ", allowedCountryCodes: [] }).defaultCountryCode, "IN");
});

test("chooses the first country when the default is missing", () => {
  const policy = buildPublicOtpCountryPolicy({ defaultCountryCode: "US", allowedCountryCodes: ["AE", "KW"] });
  assert.equal(policy.defaultCountryCode, "AE");
});

test("does not mutate settings and exposes only public-safe fields", () => {
  const allowedCountryCodes = ["IN", "AE"];
  const original = [...allowedCountryCodes];
  const serialized = JSON.stringify(buildPublicOtpCountryPolicy({ defaultCountryCode: "IN", allowedCountryCodes }));
  assert.deepEqual(allowedCountryCodes, original);
  for (const privateField of ["providerMode", "allowPlatformFallback", "merchantTwilioStatus", "merchantMsg91Status", "authToken", "accountSid", "shopId"]) {
    assert.equal(serialized.includes(privateField), false);
  }
});
