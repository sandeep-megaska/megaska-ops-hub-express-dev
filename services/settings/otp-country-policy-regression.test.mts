import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("public policy delivery leaves the India-only OTP behavior dormant", () => {
  const requestRoute = readFileSync("app/api/otp/request/route.ts", "utf8");
  const phoneService = readFileSync("services/phone.ts", "utf8");
  const modal = readFileSync("extensions/megaska-otp/assets/loopd2c-otp.js", "utf8");
  assert.match(requestRoute, /normalizeIndianPhone/);
  assert.match(phoneService, /export function normalizeIndianPhone/);
  assert.match(modal, /\+91/);
  assert.match(modal, /10 digits/);
  assert.doesNotMatch(modal, /otpCountryPolicy|country[^\n]{0,30}(select|dropdown)/i);
});
