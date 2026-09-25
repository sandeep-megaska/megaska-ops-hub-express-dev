import test from "node:test";
import assert from "node:assert/strict";
import {
  WHATSAPP_OTP_LENGTH,
  buildWhatsAppOtpTemplatePayload,
  generateWhatsAppOtpCode,
  getWhatsAppOtpConfig,
  hashWhatsAppOtpCode,
  isWhatsAppOtpEligible,
  sendOtpWithWhatsApp,
  whatsAppOtpCodeMatches,
} from "./whatsapp-otp.ts";

const liveEnv = {
  WHATSAPP_OTP_ENABLED: "true",
  WHATSAPP_OTP_ACCESS_TOKEN: "token",
  WHATSAPP_OTP_PHONE_NUMBER_ID: "12345",
} as unknown as NodeJS.ProcessEnv;

test("stays off unless explicitly enabled with credentials", () => {
  assert.equal(getWhatsAppOtpConfig({} as unknown as NodeJS.ProcessEnv).enabled, false);
  assert.equal(getWhatsAppOtpConfig({ ...liveEnv, WHATSAPP_OTP_ENABLED: "false" } as unknown as NodeJS.ProcessEnv).enabled, false);
  assert.equal(getWhatsAppOtpConfig({ ...liveEnv, WHATSAPP_OTP_ACCESS_TOKEN: "" } as unknown as NodeJS.ProcessEnv).enabled, false);
  assert.equal(getWhatsAppOtpConfig({ ...liveEnv, WHATSAPP_OTP_PHONE_NUMBER_ID: " " } as unknown as NodeJS.ProcessEnv).enabled, false);
  assert.equal(getWhatsAppOtpConfig(liveEnv).enabled, true);
});

test("does not reuse the checkout-recovery WhatsApp number", () => {
  const config = getWhatsAppOtpConfig({
    WHATSAPP_OTP_ENABLED: "true",
    WHATSAPP_META_ACCESS_TOKEN: "recovery-token",
    WHATSAPP_META_PHONE_NUMBER_ID: "999",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(config.enabled, false);
});

test("eligibility defaults to Indian numbers and honours configured prefixes", () => {
  const india = getWhatsAppOtpConfig(liveEnv);
  assert.equal(isWhatsAppOtpEligible("+919876543210", india), true);
  assert.equal(isWhatsAppOtpEligible("+14155550100", india), false);

  const multi = getWhatsAppOtpConfig({ ...liveEnv, WHATSAPP_OTP_COUNTRY_PREFIXES: "+91, +971,bogus" } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(multi.countryPrefixes, ["+91", "+971"]);
  assert.equal(isWhatsAppOtpEligible("+971501234567", multi), true);

  assert.equal(isWhatsAppOtpEligible("+919876543210", getWhatsAppOtpConfig({} as unknown as NodeJS.ProcessEnv)), false);
});

test("codes are fixed-length digits matching the storefront OTP inputs", () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(generateWhatsAppOtpCode(), new RegExp(`^\\d{${WHATSAPP_OTP_LENGTH}}$`));
  }
});

test("hash verification is per challenge and rejects wrong or malformed codes", () => {
  const hash = hashWhatsAppOtpCode("challenge-a", "0427");
  assert.equal(whatsAppOtpCodeMatches("challenge-a", "0427", hash), true);
  assert.equal(whatsAppOtpCodeMatches("challenge-a", "0428", hash), false);
  assert.equal(whatsAppOtpCodeMatches("challenge-b", "0427", hash), false);
  assert.equal(whatsAppOtpCodeMatches("challenge-a", "04 27", hash), false);
  assert.equal(whatsAppOtpCodeMatches("challenge-a", "0427", ""), false);
  assert.notEqual(hash, hashWhatsAppOtpCode("challenge-b", "0427"));
});

test("template payload fills the body and copy-code button", () => {
  const payload = buildWhatsAppOtpTemplatePayload("+919876543210", "0427", getWhatsAppOtpConfig(liveEnv));
  assert.equal(payload.to, "919876543210");
  assert.equal(payload.template.name, "loopd2c_login_otp");
  assert.deepEqual(payload.template.language, { code: "en" });
  assert.deepEqual(payload.template.components, [
    { type: "body", parameters: [{ type: "text", text: "0427" }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "0427" }] },
  ]);
});

test("send surfaces Meta errors so the route can fall back to SMS", async (t) => {
  const config = getWhatsAppOtpConfig(liveEnv);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ error: { message: "Template not found", code: 132001 } }), { status: 400 });
  });
  await assert.rejects(sendOtpWithWhatsApp("+919876543210", "0427", config), /Template not found/);
  assert.equal(calls[0].url, "https://graph.facebook.com/v20.0/12345/messages");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer token");
});

test("send returns the Meta message id on success", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid.ABC" }] }), { status: 200 })
  );
  assert.deepEqual(await sendOtpWithWhatsApp("+919876543210", "0427", getWhatsAppOtpConfig(liveEnv)), { messageId: "wamid.ABC" });
});

test("send refuses to run when disabled", async () => {
  await assert.rejects(sendOtpWithWhatsApp("+919876543210", "0427", getWhatsAppOtpConfig({} as unknown as NodeJS.ProcessEnv)), /not configured/);
});
