/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { buildMerchantWhatsAppUpdate, checkWhatsAppSender, chooseWhatsAppSender, MerchantWhatsAppValidationError, toAdminView, WHATSAPP_MASKED_TOKEN } from "./sender.ts";

const platformEnv = { WHATSAPP_OTP_ENABLED: "true", WHATSAPP_OTP_ACCESS_TOKEN: "platform-token", WHATSAPP_OTP_PHONE_NUMBER_ID: "999999999999999" };
const decrypt = (value: string) => (value.startsWith("enc:") ? value.slice(4) : null);
const account = (overrides: any = {}) => ({
  shopId: "shop-1", enabled: true, displayPhoneNumber: "+91 96393 90404", phoneNumberId: "111111111111111", businessAccountId: null,
  accessTokenEncrypted: "enc:merchant-token", accessTokenMasked: WHATSAPP_MASKED_TOKEN, templateLanguage: "en",
  otpEnabled: true, otpTemplateName: "loopd2c_login_otp", recoveryEnabled: true, recoveryFirstTemplate: "checkout_recovery",
  recoveryReminderTemplate: "checkout_recovery_reminder", exchangeEnabled: true, ...overrides,
});
const pick = (purpose: any, row: any, env: any = platformEnv) => chooseWhatsAppSender(purpose, row, { env, decrypt });

test("a shop with its own number sends everything from it", () => {
  for (const purpose of ["otp", "recovery", "exchange"]) {
    const sender = pick(purpose, account());
    assert.equal(sender?.source, "MERCHANT", purpose);
    assert.equal(sender?.phoneNumberId, "111111111111111");
    assert.equal(sender?.accessToken, "merchant-token");
  }
});

test("a shop without its own number gets OTP from the LoopD2C number and nothing else", () => {
  assert.equal(pick("otp", null)?.source, "PLATFORM");
  assert.equal(pick("otp", null)?.phoneNumberId, "999999999999999");
  assert.equal(pick("recovery", null), null);
  assert.equal(pick("exchange", null), null);
});

test("the LoopD2C number never sends recovery or exchange messages for a merchant", () => {
  const off = account({ recoveryEnabled: false, exchangeEnabled: false });
  assert.equal(pick("recovery", off), null);
  assert.equal(pick("exchange", off), null);
  assert.equal(pick("recovery", account({ enabled: false })), null);
});

test("own-number OTP switched off, account disabled or token unreadable falls back to the LoopD2C number for OTP", () => {
  assert.equal(pick("otp", account({ otpEnabled: false }))?.source, "PLATFORM");
  assert.equal(pick("otp", account({ enabled: false }))?.source, "PLATFORM");
  assert.equal(pick("otp", account({ accessTokenEncrypted: "garbage" }))?.source, "PLATFORM");
  assert.equal(pick("otp", null, {}), null, "no WhatsApp at all: SMS");
});

test("admin form validates ids and template names and only stores an encrypted token", () => {
  const encrypt = (value: string) => `enc:${value}`;
  const input = { enabled: "on", phoneNumberId: "111111111111111", accessToken: "EAAG" + "x".repeat(40), templateLanguage: "en", otpEnabled: "on" };
  const created = buildMerchantWhatsAppUpdate(input, null, encrypt);
  assert.equal(created.accessTokenEncrypted, "enc:EAAG" + "x".repeat(40));
  assert.equal(created.enabled, true);
  assert.equal(created.recoveryEnabled, false, "unchecked boxes are off");

  const kept = buildMerchantWhatsAppUpdate({ ...input, accessToken: WHATSAPP_MASKED_TOKEN }, account(), encrypt);
  assert.equal(kept.accessTokenEncrypted, "enc:merchant-token", "the mask keeps the saved token");

  assert.throws(() => buildMerchantWhatsAppUpdate({ ...input, phoneNumberId: "+91 96393 90404" }, null, encrypt), MerchantWhatsAppValidationError);
  assert.throws(() => buildMerchantWhatsAppUpdate({ ...input, otpTemplateName: "Login OTP" }, null, encrypt), MerchantWhatsAppValidationError);
  assert.throws(() => buildMerchantWhatsAppUpdate({ ...input, accessToken: "" }, null, encrypt), /Access token is required/);
  assert.throws(() => buildMerchantWhatsAppUpdate(input, null, () => null), /encryption key/, "never stores a plaintext token");
});

test("admin view never exposes the token", () => {
  const view = toAdminView(account() as any, platformEnv);
  assert.equal(view.accessTokenMasked, WHATSAPP_MASKED_TOKEN);
  assert.equal(JSON.stringify(view).includes("merchant-token"), false);
  assert.equal(view.platformOtpAvailable, true);
});

test("connection check is a read-only call and reports Meta's answer", async () => {
  const calls: any[] = [];
  const ok = await checkWhatsAppSender({ accessToken: "t", phoneNumberId: "111111111111111" }, (async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, json: async () => ({ display_phone_number: "+91 96393 90404", verified_name: "Megaska", quality_rating: "GREEN" }) }; }) as any, "v20.0");
  assert.equal(ok.ok, true);
  assert.match(ok.message, /Megaska.*GREEN/);
  assert.equal(calls[0].init.method, undefined, "GET only");
  const bad = await checkWhatsAppSender({ accessToken: "t", phoneNumberId: "1" }, (async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid OAuth access token" } }) })) as any, "v20.0");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Invalid OAuth/);
});

test("OTP send config uses the chosen number, its template and language; no sender means SMS", async () => {
  const { otpConfigFromSender, isWhatsAppOtpEligible, buildWhatsAppOtpTemplatePayload } = await import("../auth/whatsapp-otp.ts");
  const base = { enabled: true, accessToken: "platform-token", phoneNumberId: "999999999999999", templateName: "loopd2c_login_otp", languageCode: "en", graphVersion: "v20.0", countryPrefixes: ["+91"] };
  const own = otpConfigFromSender(pick("otp", account({ otpTemplateName: "megaska_login", templateLanguage: "en_US" })), base);
  assert.equal(own.source, "MERCHANT");
  assert.equal(own.config.phoneNumberId, "111111111111111");
  assert.equal(own.config.accessToken, "merchant-token");
  assert.equal(buildWhatsAppOtpTemplatePayload("+919639390404", "1234", own.config).template.name, "megaska_login");
  assert.equal(buildWhatsAppOtpTemplatePayload("+919639390404", "1234", own.config).template.language.code, "en_US");

  const none = otpConfigFromSender(null, base);
  assert.equal(none.source, null);
  assert.equal(isWhatsAppOtpEligible("+919639390404", none.config), false);
});

test("growth message settings: second-order nudge needs a real offer line and a sensible delay", () => {
  const encrypt = (value: string) => `enc:${value}`;
  const input = { enabled: "on", phoneNumberId: "111111111111111", accessToken: "EAAG" + "x".repeat(40), templateLanguage: "en" };
  const saved = buildMerchantWhatsAppUpdate({ ...input, backInStockEnabled: "on", reviewRequestsEnabled: "on", secondOrderEnabled: "on", secondOrderDelayDays: "28", secondOrderOffer: "  Prepaid orders   get 15% off at checkout. " }, null, encrypt);
  assert.equal(saved.backInStockEnabled, true);
  assert.equal(saved.reviewRequestsEnabled, true);
  assert.equal(saved.secondOrderDelayDays, 28);
  assert.equal(saved.secondOrderOffer, "Prepaid orders get 15% off at checkout.");
  assert.equal(buildMerchantWhatsAppUpdate(input, null, encrypt).secondOrderDelayDays, 21, "default");
  assert.throws(() => buildMerchantWhatsAppUpdate({ ...input, secondOrderEnabled: "on" }, null, encrypt), MerchantWhatsAppValidationError, "offer line required when on");
  assert.throws(() => buildMerchantWhatsAppUpdate({ ...input, secondOrderDelayDays: "3" }, null, encrypt), MerchantWhatsAppValidationError);
  assert.equal(toAdminView(null).secondOrderDelayDays, 21);
});

test("reporting ad sales to Meta needs the WhatsApp Business Account ID", () => {
  const encrypt = (value: string) => `enc:${value}`;
  const input = { enabled: "on", phoneNumberId: "111111111111111", accessToken: "EAAG" + "x".repeat(40), templateLanguage: "en" };
  assert.throws(() => buildMerchantWhatsAppUpdate({ ...input, adConversionsEnabled: "on" }, null, encrypt), MerchantWhatsAppValidationError);
  assert.equal(buildMerchantWhatsAppUpdate({ ...input, businessAccountId: "1619844212877837", adConversionsEnabled: "on" }, null, encrypt).adConversionsEnabled, true);
});
