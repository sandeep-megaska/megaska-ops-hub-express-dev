// Server-only service: import only from server components, server actions, or route handlers.
import { prisma } from "../db/prisma.ts";

export const OTP_PROVIDER_MODES = ["PLATFORM_TWILIO", "MERCHANT_TWILIO", "MERCHANT_MSG91", "MOCK"] as const;
export const OTP_PROVIDER_STATUSES = ["NOT_CONFIGURED", "PENDING_VERIFICATION", "VERIFIED", "ACTIVE", "SUSPENDED", "ERROR"] as const;

export type OtpProviderMode = (typeof OTP_PROVIDER_MODES)[number];
export type OtpProviderStatus = (typeof OTP_PROVIDER_STATUSES)[number];

type ShopRecord = { id: string; shopDomain: string };
type TwilioRecord = { status: OtpProviderStatus } | null;
type Msg91Record = { status: OtpProviderStatus; kycApproved: boolean; dltApproved: boolean; templateApproved: boolean } | null;
type SettingsRecord = {
  id: string;
  shopId: string;
  otpEnabled: boolean;
  providerMode: OtpProviderMode;
  allowPlatformFallback: boolean;
  defaultCountryCode: string;
  allowedCountryCodes: string[];
  twilioSettings?: TwilioRecord;
  msg91Settings?: Msg91Record;
};

export type MerchantOtpSettingsDb = {
  shop: { findUnique(args: { where: { id: string }; select: { id: true; shopDomain: true } }): Promise<ShopRecord | null> };
  merchantOtpSettings: {
    findUnique(args: { where: { shopId: string }; include?: { twilioSettings: true; msg91Settings: true } }): Promise<SettingsRecord | null>;
    upsert(args: { where: { shopId: string }; create: { shopId: string; otpEnabled: boolean; providerMode: OtpProviderMode; allowPlatformFallback: boolean; defaultCountryCode: string; allowedCountryCodes: string[] }; update: { otpEnabled: boolean; providerMode: OtpProviderMode; allowPlatformFallback: boolean; defaultCountryCode: string; allowedCountryCodes: string[] }; include: { twilioSettings: true; msg91Settings: true } }): Promise<SettingsRecord>;
  };
};

export type ResolvedMerchantOtpSettings = {
  shopId: string;
  otpEnabled: boolean;
  providerMode: OtpProviderMode;
  allowPlatformFallback: boolean;
  defaultCountryCode: string;
  allowedCountryCodes: string[];
  hasSettingsRow: boolean;
  merchantTwilioStatus: OtpProviderStatus;
  merchantMsg91Status: OtpProviderStatus;
};

export type MerchantOtpSettingsInput = {
  otpEnabled: unknown;
  providerMode: unknown;
  allowPlatformFallback: unknown;
  defaultCountryCode?: unknown;
  allowedCountryCodes?: unknown;
};

export class MerchantOtpSettingsValidationError extends Error {
  constructor(message: string) { super(message); this.name = "MerchantOtpSettingsValidationError"; }
}

function resolveDb(db?: MerchantOtpSettingsDb) { return (db || prisma) as unknown as MerchantOtpSettingsDb; }
function log(operation: string, details: Record<string, unknown>) { console.info("[MERCHANT OTP SETTINGS]", { operation, ...details }); }
function parseBoolean(input: unknown, field: string) {
  if (typeof input === "boolean") return input;
  if (input === "true" || input === "false") return input === "true";
  throw new MerchantOtpSettingsValidationError(`${field} must be true or false.`);
}
function isMode(input: unknown): input is OtpProviderMode { return typeof input === "string" && (OTP_PROVIDER_MODES as readonly string[]).includes(input); }
function status(input: TwilioRecord | Msg91Record | undefined) { return input?.status || "NOT_CONFIGURED"; }
const INDIA_ONLY_POLICY = { defaultCountryCode: "IN", allowedCountryCodes: ["IN"] } as const;
const MAX_ALLOWED_COUNTRY_CODES = 250;
function parseCountryCode(input: unknown, field: string) {
  if (typeof input !== "string" || !/^[A-Za-z]{2}$/.test(input.trim())) throw new MerchantOtpSettingsValidationError(`${field} must be a two-letter country code.`);
  return input.trim().toUpperCase();
}
function parseAllowedCountryCodes(input: unknown) {
  if (!Array.isArray(input)) throw new MerchantOtpSettingsValidationError("Allowed countries must be an array.");
  if (input.length > MAX_ALLOWED_COUNTRY_CODES) throw new MerchantOtpSettingsValidationError(`Allowed countries cannot contain more than ${MAX_ALLOWED_COUNTRY_CODES} entries.`);
  const normalized = input.map((value) => parseCountryCode(value, "Each allowed country"));
  const unique = [...new Set(normalized)];
  if (unique.length === 0) throw new MerchantOtpSettingsValidationError("At least one allowed country is required.");
  return unique;
}
function persistedCountryPolicy(row: SettingsRecord | null) {
  if (!row) return { defaultCountryCode: INDIA_ONLY_POLICY.defaultCountryCode, allowedCountryCodes: [...INDIA_ONLY_POLICY.allowedCountryCodes] };
  try {
    const defaultCountryCode = parseCountryCode(row.defaultCountryCode, "Default country");
    const allowedCountryCodes = parseAllowedCountryCodes(row.allowedCountryCodes);
    if (!allowedCountryCodes.includes(defaultCountryCode)) throw new MerchantOtpSettingsValidationError("Default country must be allowed.");
    return { defaultCountryCode, allowedCountryCodes };
  } catch {
    return { defaultCountryCode: INDIA_ONLY_POLICY.defaultCountryCode, allowedCountryCodes: [...INDIA_ONLY_POLICY.allowedCountryCodes] };
  }
}
function defaults(shopId: string): ResolvedMerchantOtpSettings { return { shopId, otpEnabled: true, providerMode: "PLATFORM_TWILIO", allowPlatformFallback: true, ...persistedCountryPolicy(null), hasSettingsRow: false, merchantTwilioStatus: "NOT_CONFIGURED", merchantMsg91Status: "NOT_CONFIGURED" }; }
function toResolved(row: SettingsRecord): ResolvedMerchantOtpSettings {
  return { shopId: row.shopId, otpEnabled: row.otpEnabled, providerMode: row.providerMode, allowPlatformFallback: row.allowPlatformFallback, ...persistedCountryPolicy(row), hasSettingsRow: true, merchantTwilioStatus: status(row.twilioSettings), merchantMsg91Status: status(row.msg91Settings) };
}

export function getPlatformTwilioConfigurationStatus(env: NodeJS.ProcessEnv = process.env) {
  const hasAccountSid = Boolean(env.TWILIO_ACCOUNT_SID?.trim());
  const hasAuthToken = Boolean(env.TWILIO_AUTH_TOKEN?.trim());
  const hasVerifyServiceSid = Boolean(env.TWILIO_VERIFY_SERVICE_SID?.trim());
  return { configured: hasAccountSid && hasAuthToken && hasVerifyServiceSid, hasAccountSid, hasAuthToken, hasVerifyServiceSid };
}

export async function getMerchantOtpSettings(shopId: string, db?: MerchantOtpSettingsDb): Promise<ResolvedMerchantOtpSettings> {
  const client = resolveDb(db);
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: { id: true, shopDomain: true } });
  if (!shop) { log("unresolved_shop", { shopId }); throw new Error("Unable to resolve shop OTP settings."); }
  const row = await client.merchantOtpSettings.findUnique({ where: { shopId: shop.id }, include: { twilioSettings: true, msg91Settings: true } });
  const resolved = row ? toResolved(row) : defaults(shop.id);
  log("loaded", { shopId: shop.id, shopDomain: shop.shopDomain, providerMode: resolved.providerMode, otpEnabled: resolved.otpEnabled, allowPlatformFallback: resolved.allowPlatformFallback, defaultCountryCode: resolved.defaultCountryCode, allowedCountryCount: resolved.allowedCountryCodes.length, hasSettingsRow: resolved.hasSettingsRow, merchantTwilioStatus: resolved.merchantTwilioStatus, merchantMsg91Status: resolved.merchantMsg91Status });
  return resolved;
}

function validate(input: MerchantOtpSettingsInput, existing: SettingsRecord | null) {
  const otpEnabled = parseBoolean(input.otpEnabled, "Enable OTP authentication");
  const allowPlatformFallback = parseBoolean(input.allowPlatformFallback, "Allow platform Twilio fallback");
  if (!isMode(input.providerMode)) throw new MerchantOtpSettingsValidationError("Preferred OTP provider is not supported.");
  const providerMode = input.providerMode;
  if (providerMode === "MOCK" && process.env.NODE_ENV === "production") throw new MerchantOtpSettingsValidationError("Mock OTP provider cannot be selected in production.");
  if (providerMode === "MERCHANT_TWILIO" && !["VERIFIED", "ACTIVE"].includes(status(existing?.twilioSettings))) throw new MerchantOtpSettingsValidationError("Merchant Twilio cannot be activated until verification support marks it verified.");
  const msg91 = existing?.msg91Settings;
  if (providerMode === "MERCHANT_MSG91" && !(msg91 && ["VERIFIED", "ACTIVE"].includes(msg91.status) && msg91.kycApproved && msg91.dltApproved && msg91.templateApproved)) throw new MerchantOtpSettingsValidationError("Merchant MSG91 cannot be activated until KYC, DLT, template approval, and verification are complete.");
  const fallbackPolicy = persistedCountryPolicy(existing);
  const defaultCountryCode = input.defaultCountryCode === undefined ? fallbackPolicy.defaultCountryCode : parseCountryCode(input.defaultCountryCode, "Default country");
  const allowedCountryCodes = input.allowedCountryCodes === undefined ? fallbackPolicy.allowedCountryCodes : parseAllowedCountryCodes(input.allowedCountryCodes);
  if (!allowedCountryCodes.includes(defaultCountryCode)) throw new MerchantOtpSettingsValidationError("Default country must be included in allowed countries.");
  return { otpEnabled, providerMode, allowPlatformFallback, defaultCountryCode, allowedCountryCodes };
}

export async function saveMerchantOtpSettings(shopId: string, input: MerchantOtpSettingsInput, db?: MerchantOtpSettingsDb): Promise<ResolvedMerchantOtpSettings> {
  const client = resolveDb(db);
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: { id: true, shopDomain: true } });
  if (!shop) { log("unresolved_shop", { shopId }); throw new Error("Unable to resolve shop OTP settings."); }
  const existing = await client.merchantOtpSettings.findUnique({ where: { shopId: shop.id }, include: { twilioSettings: true, msg91Settings: true } });
  let data: ReturnType<typeof validate>;
  try { data = validate(input, existing); }
  catch (error) { log(error instanceof MerchantOtpSettingsValidationError && ["MERCHANT_TWILIO", "MERCHANT_MSG91"].includes(String(input.providerMode)) ? "provider_activation_rejected" : "validation_rejected", { shopId: shop.id, shopDomain: shop.shopDomain, providerMode: String(input.providerMode || "") }); throw error; }
  const saved = await client.merchantOtpSettings.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, ...data }, update: data, include: { twilioSettings: true, msg91Settings: true } });
  const resolved = toResolved(saved);
  log(existing ? "updated" : "created", { shopId: shop.id, shopDomain: shop.shopDomain, providerMode: resolved.providerMode, otpEnabled: resolved.otpEnabled, allowPlatformFallback: resolved.allowPlatformFallback, defaultCountryCode: resolved.defaultCountryCode, allowedCountryCount: resolved.allowedCountryCodes.length, hasSettingsRow: true, merchantTwilioStatus: resolved.merchantTwilioStatus, merchantMsg91Status: resolved.merchantMsg91Status });
  return resolved;
}
