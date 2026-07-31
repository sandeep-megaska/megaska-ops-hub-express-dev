import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const otpSource = readFileSync(new URL("../../extensions/megaska-otp/assets/loopd2c-otp.js", import.meta.url), "utf8");
const authSource = readFileSync(new URL("../../extensions/megaska-otp/assets/loopd2c-auth.js", import.meta.url), "utf8");

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
  otpSource.indexOf('  const state = {')
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
  const applyPolicy = extractFunction("applyCountryPolicyToCurrentPhoneStep");
  assert.match(applyPolicy, /state\.step !== "phone"/);
  assert.match(applyPolicy, /state\.otpRequestCountryCode/);
  assert.match(otpSource, /loopdesk:runtime-config-ready/);
});

function createPolicyRuntime() {
  const runtime = { Set, window: { LoopDeskConfig: {} } };
  vm.runInNewContext(`
    const INDIA_OTP_COUNTRY = { iso2: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" };
    const INTERNATIONAL_PHONE_MAX_LENGTH = 20;
    let cachedOtpCountryPolicy = null;
    let otpRuntimePolicyReady = false;
    function applyCountryPolicyToCurrentPhoneStep() {}
    ${helperSource}
    this.policyRuntime = { resolveOtpCountryPolicy, setCachedOtpCountryPolicy };
  `, runtime);
  return runtime;
}

test("a valid runtime policy is cached and missing runtime data cannot downgrade it", () => {
  const runtime = createPolicyRuntime();
  runtime.window.LoopDeskConfig.otpCountryPolicy = {
    defaultCountryCode: "KW",
    allowedCountries: [KUWAIT, { iso2: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" }],
  };
  assert.equal(runtime.policyRuntime.resolveOtpCountryPolicy().defaultCountryCode, "KW");
  delete runtime.window.LoopDeskConfig.otpCountryPolicy;
  const cached = plain(runtime.policyRuntime.resolveOtpCountryPolicy());
  assert.equal(cached.defaultCountryCode, "KW");
  assert.deepEqual(cached.allowedCountries.map((country) => country.iso2), ["KW", "IN"]);
});

test("a fresh page without runtime policy retains the India fallback", () => {
  const runtime = createPolicyRuntime();
  assert.equal(runtime.policyRuntime.resolveOtpCountryPolicy().defaultCountryCode, "IN");
});

test("modal hydration is bounded and every reset restores the effective merchant default", () => {
  const openModal = extractFunction("openModal");
  const resetModalState = extractFunction("resetModalState");
  assert.match(openModal, /OTP_POLICY_HYDRATION_TIMEOUT_MS/);
  assert.match(openModal, /otpPolicyHydrating = true/);
  assert.match(openModal, /hasUsableOtpCountryPolicy\(window\.LoopDeskConfig\?\.otpCountryPolicy\)/);
  assert.match(resetModalState, /state\.otpCountryPolicy = resolveOtpCountryPolicy\(\)/);
  assert.match(resetModalState, /state\.selectedOtpCountryCode = state\.otpCountryPolicy\.defaultCountryCode/);
  assert.match(resetModalState, /state\.countryMenuOpen = false/);
  assert.match(resetModalState, /state\.otpRequestCountryCode = preservePhone \? state\.otpRequestCountryCode : ""/);
});

test("the page cache survives modal reset and delayed policy application cannot alter a frozen request", () => {
  const resetModalState = extractFunction("resetModalState");
  const applyPolicy = extractFunction("applyCountryPolicyToCurrentPhoneStep");
  assert.doesNotMatch(resetModalState, /cachedOtpCountryPolicy\s*=/);
  assert.doesNotMatch(resetModalState, /otpRuntimePolicyReady\s*=/);
  assert.match(applyPolicy, /state\.otpRequestCountryCode/);
  assert.match(otpSource, /requestOtp\(state\.otpRequestPhoneInput, state\.otpRequestCountryCode\)/);
});

test("protected OTP continuation and endpoint behavior remains present", () => {
  assert.match(otpSource, /await resumePendingAction\(sessionCustomer\)/);
  assert.match(otpSource, /consumePendingAccountRedirect\(\)/);
  assert.match(otpSource, /async function handleResend\(\)/);
  assert.match(authSource, /apiFetch\("\/otp\/request"/);
  assert.match(authSource, /apiFetch\("\/otp\/verify"/);
  assert.doesNotMatch(otpSource, /SESSION_KEY|setSessionToken/);
});

test("phone helper gives universal country-code guidance", () => {
  const renderStep = extractFunction("renderStep");
  assert.match(renderStep, /phoneHint\.textContent = "Enter your mobile number without the country code\."/);
  assert.doesNotMatch(renderStep, /phoneHint\.textContent = [^;]*10-digit/i);
});

test("country control remains a sibling of the phone input", () => {
  assert.match(
    otpSource,
    /megaska-otp-phone-wrap megaska-otp-phone-field[\s\S]*data-megaska-country-control[\s\S]*data-megaska-phone-input/,
  );
  const renderCountryControl = extractFunction("renderOtpCountryControl");
  assert.match(renderCountryControl, /control\.textContent = "";/);
  assert.doesNotMatch(renderCountryControl, /data-megaska-phone-input|megaska-otp-phone-input/);
  assert.match(renderCountryControl, /control\.appendChild\(trigger\)/);
  assert.match(renderCountryControl, /control\.appendChild\(menu\)/);
});

test("collapsed trigger and country options use compact, aligned country content", () => {
  const renderCountryControl = extractFunction("renderOtpCountryControl");
  assert.match(renderCountryControl, /megaska-otp-country-iso[^`]*selected\.iso2/);
  assert.match(renderCountryControl, /megaska-otp-country-dial-code[^`]*selected\.dialCode/);
  assert.match(renderCountryControl, /megaska-otp-country-iso[^`]*country\.iso2/);
  assert.match(renderCountryControl, /megaska-otp-country-name[^`]*country\.name/);
  assert.match(renderCountryControl, /megaska-otp-country-dial-code[^`]*country\.dialCode/);

  const cssSource = readFileSync(new URL("../../extensions/megaska-otp/assets/loopd2c-otp.css", import.meta.url), "utf8");
  assert.match(cssSource, /grid-template-columns:\s*32px minmax\(0, 1fr\) auto/);
  assert.doesNotMatch(cssSource, /megaska-otp-country-option\[aria-selected="true"\]::after/);
});
