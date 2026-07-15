import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveOtpUsageCountryCode, recordAcceptedOtpRequestUsage } from "./otp-usage.ts";

test("Indian number may record country code IN and other countries are not guessed", () => {
  assert.equal(deriveOtpUsageCountryCode("+919876543210"), "IN");
  assert.equal(deriveOtpUsageCountryCode("+15551234567"), null);
});

test("OTP wrapper records generic OTP request fields without storing full phone", () => {
  const source = readFileSync(new URL("./otp-usage.ts", import.meta.url), "utf8");
  assert.match(source, /usageType: "OTP"/);
  assert.match(source, /action: "OTP_REQUEST"/);
  assert.match(source, /provider: input\.provider/);
  assert.match(source, /quantity: 1/);
  assert.match(source, /sourceType: "OTP_CHALLENGE"/);
  assert.match(source, /sourceId: input\.challengeId/);
  assert.match(source, /providerReference: input\.providerSid \?\? null/);
  assert.match(source, /usage:otp-request:\$\{input\.shopId\}:\$\{input\.challengeId\}/);
  assert.doesNotMatch(source, /phoneE164[,}]/);
});

test("OTP request route records usage only after challenge creation and isolates failures", () => {
  const source = readFileSync(new URL("../../app/api/otp/request/route.ts", import.meta.url), "utf8");
  assert.match(source, /const twilioVerification = await sendOtpWithTwilio\(phoneE164\);[\s\S]*const challenge = await prisma\.oTPChallenge\.create[\s\S]*await recordAcceptedOtpRequestUsage/);
  assert.match(source, /catch \(error\) \{[\s\S]*otp_usage_record_failed[\s\S]*\}/);
  assert.match(source, /providerSid: twilioVerification\.sid \?\? null/);
});

test("Twilio failure, provider failure, invalid phone, and verification route do not record usage", () => {
  const requestSource = readFileSync(new URL("../../app/api/otp/request/route.ts", import.meta.url), "utf8");
  const verifySource = readFileSync(new URL("../../app/api/otp/verify/route.ts", import.meta.url), "utf8");
  assert.match(requestSource, /if \(!phoneE164\)[\s\S]*Invalid phone format/);
  assert.match(requestSource, /if \(resolution\.available === false\)[\s\S]*return withCors/);
  assert.match(requestSource, /catch \(providerError\)[\s\S]*Unable to send OTP/);
  assert.doesNotMatch(verifySource, /recordAcceptedOtpRequestUsage|recordMerchantUsage|MerchantUsageEvent|merchantUsageEvent/);
});

void recordAcceptedOtpRequestUsage;
