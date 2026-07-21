import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const otpSource = readFileSync(new URL("../assets/megaska-otp.js", import.meta.url), "utf8");
const authSource = readFileSync(new URL("../assets/megaska-auth.js", import.meta.url), "utf8");

function extractFunction(name) {
  const start = otpSource.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  let brace = otpSource.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < otpSource.length; index += 1) {
    if (otpSource[index] === "{") depth += 1;
    if (otpSource[index] === "}" && --depth === 0) return otpSource.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const context = { Set };
const helperSource = otpSource.slice(
  otpSource.indexOf('  function sanitizeOtpCountryPolicy('),
  otpSource.indexOf('  const INDIAN_STATES_AND_UTS')
);
vm.runInNewContext(`
  const INDIA_OTP_COUNTRY = { iso2: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" };
  const INTERNATIONAL_PHONE_MAX_LENGTH = 20;
  ${helperSource}
  this.helpers = { sanitizeOtpCountryPolicy, sanitizePhoneInputForCountry, maskOtpDestination };
`, context);
const { sanitizeOtpCountryPolicy, sanitizePhoneInputForCountry, maskOtpDestination } = context.helpers;
const plain = (value) => JSON.parse(JSON.stringify(value));

const UAE = { iso2: "ae", name: "United Arab Emirates", dialCode: "+971", flag: "🇦🇪" };
const KUWAIT = { iso2: "KW", name: "Kuwait", dialCode: "+965", flag: "🇰🇼" };

test("missing and malformed policies fall back safely to India fixed-prefix mode", () => {
  for (const policy of [undefined, {}, { allowedCountries: [{ iso2: "USA" }] }]) {
    const result = plain(sanitizeOtpCountryPolicy(policy));
    assert.equal(result.defaultCountryCode, "IN");
    assert.deepEqual(result.allowedCountries, [{ iso2: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" }]);
    assert.equal(result.allowedCountries.length === 1, true);
  }
});

test("sanitization removes malformed and duplicate countries and honors a configured default", () => {
  const result = plain(sanitizeOtpCountryPolicy({
    defaultCountryCode: "kw",
    allowedCountries: [UAE, { ...UAE, name: "duplicate" }, { iso2: "X", name: "Bad", dialCode: "1", flag: "x" }, KUWAIT],
  }));
  assert.deepEqual(result.allowedCountries, [{ ...UAE, iso2: "AE" }, KUWAIT]);
  assert.equal(result.defaultCountryCode, "KW");
  assert.equal(result.allowedCountries.length > 1, true);
});

test("a missing configured default selects the first valid country", () => {
  assert.equal(sanitizeOtpCountryPolicy({ defaultCountryCode: "IN", allowedCountries: [UAE, KUWAIT] }).defaultCountryCode, "AE");
});

test("India input retains ten-digit truncation while international input does not", () => {
  assert.equal(sanitizePhoneInputForCountry("+91 98765-43210 99", "IN"), "9198765432");
  assert.equal(sanitizePhoneInputForCountry("+(971) 050-123-456789", "AE"), "971050123456789");
});

test("destination masking uses country metadata rather than hardcoded India data", () => {
  assert.equal(maskOtpDestination({ phoneE164: "+971501234567", country: { ...UAE, iso2: "AE" } }), "🇦🇪 +971 •••••4567");
  assert.doesNotMatch(maskOtpDestination({ phoneInput: "50000000", country: KUWAIT }), /\+91/);
});

test("request and verification payloads include country and verification uses the frozen snapshot", () => {
  assert.match(authSource, /JSON\.stringify\(\{ phone, countryCode \}\)/);
  assert.match(authSource, /JSON\.stringify\(\{ phone, countryCode, otp \}\)/);
  assert.match(otpSource, /verifyOtp\(state\.otpRequestPhoneInput, otp, state\.otpRequestCountryCode\)/);
  assert.match(otpSource, /requestOtp\(state\.otpRequestPhoneInput, state\.otpRequestCountryCode\)/);
});

test("runtime policy updates are gated to phone entry before a request snapshot", () => {
  const refresh = extractFunction("refreshOtpCountryPolicy");
  assert.match(refresh, /state\.step !== "phone"/);
  assert.match(refresh, /state\.otpRequestCountryCode/);
  assert.match(otpSource, /loopdesk:runtime-config-ready/);
});

test("protected OTP continuation and endpoint behavior remains present", () => {
  assert.match(otpSource, /await resumePendingAction\(sessionCustomer\)/);
  assert.match(otpSource, /consumePendingAccountRedirect\(\)/);
  assert.match(otpSource, /async function handleResend\(\)/);
  assert.match(authSource, /apiFetch\("\/otp\/request"/);
  assert.match(authSource, /apiFetch\("\/otp\/verify"/);
  assert.doesNotMatch(otpSource, /SESSION_KEY|setSessionToken/);
});
