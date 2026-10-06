// Server-only WhatsApp OTP transport (Meta WhatsApp Cloud API, authentication
// template). Unlike Twilio Verify, the code is generated, stored (hashed) and
// checked by us; Meta only delivers it. The sending number is chosen per shop
// (see services/whatsapp/sender.ts): the shop's own number, else the shared
// LoopD2C platform number.
import crypto from "node:crypto";
import { resolveWhatsAppSender, type WhatsAppSender, type WhatsAppSenderSource } from "../whatsapp/sender.ts";

export const WHATSAPP_OTP_PROVIDER = "whatsapp";
export const WHATSAPP_OTP_LENGTH = 4; // must match OTP_LENGTH in loopd2c-otp.js
export const WHATSAPP_OTP_MAX_ATTEMPTS = 5;
export const WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS = 25;
export const WHATSAPP_OTP_WINDOW_MINUTES = 15;
export const WHATSAPP_OTP_MAX_PER_WINDOW = 5;

export type WhatsAppOtpConfig = {
  enabled: boolean;
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  languageCode: string;
  graphVersion: string;
  countryPrefixes: string[];
};

export function getWhatsAppOtpConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppOtpConfig {
  const accessToken = String(env.WHATSAPP_OTP_ACCESS_TOKEN || "").trim();
  const phoneNumberId = String(env.WHATSAPP_OTP_PHONE_NUMBER_ID || "").trim();
  const countryPrefixes = String(env.WHATSAPP_OTP_COUNTRY_PREFIXES || "+91")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter((prefix) => /^\+\d{1,4}$/.test(prefix));
  return {
    // Explicit switch so credentials can be staged before going live.
    enabled: String(env.WHATSAPP_OTP_ENABLED || "").trim().toLowerCase() === "true" && Boolean(accessToken && phoneNumberId),
    accessToken,
    phoneNumberId,
    templateName: String(env.WHATSAPP_OTP_TEMPLATE_NAME || "loopd2c_login_otp").trim(),
    languageCode: String(env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || "en").trim(),
    graphVersion: String(env.WHATSAPP_OTP_GRAPH_VERSION || "v20.0").trim().replace(/^\/+|\/+$/g, ""),
    countryPrefixes,
  };
}

// Per-shop OTP config: the shop's own WhatsApp number when it has one with OTP
// switched on, otherwise the shared LoopD2C platform number (WHATSAPP_OTP_* env).
// `enabled` is false when neither is available, so the shop gets SMS.
export type ShopWhatsAppOtp = { config: WhatsAppOtpConfig; source: WhatsAppSenderSource | null };

export function otpConfigFromSender(sender: WhatsAppSender | null, base: WhatsAppOtpConfig = getWhatsAppOtpConfig()): ShopWhatsAppOtp {
  if (!sender) return { config: { ...base, enabled: false }, source: null };
  return {
    config: {
      ...base,
      enabled: true,
      accessToken: sender.accessToken,
      phoneNumberId: sender.phoneNumberId,
      templateName: sender.templates.otp || base.templateName,
      languageCode: sender.languageCode || base.languageCode,
    },
    source: sender.source,
  };
}

export async function resolveShopWhatsAppOtp(shopId: string): Promise<ShopWhatsAppOtp> {
  return otpConfigFromSender(await resolveWhatsAppSender(shopId, "otp"));
}

export function isWhatsAppOtpEligible(phoneE164: string, config: WhatsAppOtpConfig = getWhatsAppOtpConfig()) {
  if (!config.enabled) return false;
  return config.countryPrefixes.some((prefix) => phoneE164.startsWith(prefix));
}

export function generateWhatsAppOtpCode() {
  return String(crypto.randomInt(0, 10 ** WHATSAPP_OTP_LENGTH)).padStart(WHATSAPP_OTP_LENGTH, "0");
}

// Salted with the challenge id so equal codes never share a hash.
export function hashWhatsAppOtpCode(challengeId: string, code: string) {
  return crypto.createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
}

export function whatsAppOtpCodeMatches(challengeId: string, code: string, storedHash: string) {
  if (!storedHash || !/^\d+$/.test(code)) return false;
  const provided = Buffer.from(hashWhatsAppOtpCode(challengeId, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return provided.length === stored.length && crypto.timingSafeEqual(provided, stored);
}

// Authentication templates with a copy-code button take the code twice: once
// for the body placeholder and once for the button (sub_type "url", index 0).
export function buildWhatsAppOtpTemplatePayload(phoneE164: string, code: string, config: WhatsAppOtpConfig) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phoneE164.replace(/^\+/, ""),
    type: "template",
    template: {
      name: config.templateName,
      language: { code: config.languageCode },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ],
    },
  };
}

type MetaMessageResponse = {
  messages?: Array<{ id?: string; message_status?: string }>;
  error?: { message?: string; code?: number; error_subcode?: number };
};

export type WhatsAppOtpSendResult = { messageId: string | null };

export async function sendOtpWithWhatsApp(
  phoneE164: string,
  code: string,
  config: WhatsAppOtpConfig = getWhatsAppOtpConfig()
): Promise<WhatsAppOtpSendResult> {
  if (!config.enabled) throw new Error("WhatsApp OTP provider is not configured");

  const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildWhatsAppOtpTemplatePayload(phoneE164, code, config)),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as MetaMessageResponse | null;

  console.info("[OTP WHATSAPP SEND RESPONSE]", {
    statusCode: response.status,
    ok: response.ok,
    errorCode: data?.error?.code ?? null,
    hasMessageId: Boolean(data?.messages?.[0]?.id),
  });

  if (!response.ok) {
    throw new Error(data?.error?.message || `Meta WhatsApp Cloud API HTTP ${response.status}`);
  }

  return { messageId: data?.messages?.[0]?.id || null };
}
