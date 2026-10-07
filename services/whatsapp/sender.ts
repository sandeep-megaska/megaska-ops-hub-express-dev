// Which WhatsApp number sends a message for a shop.
//
//   Merchant's own number (MerchantWhatsAppAccount, enabled) — OTP, abandoned-checkout
//   recovery and exchange updates, each behind its own toggle.
//   LoopD2C platform number (WHATSAPP_OTP_* env) — OTP only, for shops without
//   their own number (or with own-number OTP switched off).
//
// The platform number never sends marketing or order updates for a merchant:
// those must come from the merchant's own WhatsApp Business account, under the
// merchant's brand, so one store's messages can never go out under another's
// name and the shared number's quality rating cannot be hurt by any one store.

import { decryptShopifyToken, encryptShopifyToken } from "../shopify/token-crypto.ts";

export type WhatsAppPurpose = "otp" | "recovery" | "exchange";
export type WhatsAppSenderSource = "MERCHANT" | "PLATFORM";

export type WhatsAppSender = {
  source: WhatsAppSenderSource;
  accessToken: string;
  phoneNumberId: string;
  languageCode: string;
  // Template names for the purpose being sent.
  templates: { otp?: string; recoveryFirst?: string; recoveryReminder?: string };
};

export type MerchantWhatsAppAccountRow = {
  shopId: string;
  enabled: boolean;
  displayPhoneNumber: string | null;
  phoneNumberId: string;
  businessAccountId: string | null;
  accessTokenEncrypted: string;
  accessTokenMasked: string | null;
  templateLanguage: string;
  otpEnabled: boolean;
  otpTemplateName: string;
  recoveryEnabled: boolean;
  recoveryFirstTemplate: string;
  recoveryReminderTemplate: string;
  exchangeEnabled: boolean;
  aiMode?: string | null;
  aiKnowledge?: string | null;
  lastCheckedAt?: Date | null;
  lastCheckStatus?: string | null;
  lastCheckMessage?: string | null;
};

type AccountDb = {
  merchantWhatsAppAccount: {
    findUnique(args: { where: { shopId: string } }): Promise<MerchantWhatsAppAccountRow | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<MerchantWhatsAppAccountRow[]>;
  };
};

async function defaultDb(): Promise<AccountDb> {
  return (await import("../db/prisma.ts")).prisma as unknown as AccountDb;
}

export async function getMerchantWhatsAppAccount(shopId: string, db?: AccountDb): Promise<MerchantWhatsAppAccountRow | null> {
  if (!shopId) return null;
  try {
    return await (db ?? (await defaultDb())).merchantWhatsAppAccount.findUnique({ where: { shopId } });
  } catch (error) {
    // Table not migrated yet, or DB unavailable: behave as "no own number".
    console.warn("[WHATSAPP SENDER] account_lookup_failed", { shopId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

// Shops whose own number has abandoned-checkout recovery switched on.
export async function listRecoveryWhatsAppAccounts(db?: AccountDb): Promise<MerchantWhatsAppAccountRow[]> {
  try {
    return await (db ?? (await defaultDb())).merchantWhatsAppAccount.findMany({ where: { enabled: true, recoveryEnabled: true } });
  } catch (error) {
    console.warn("[WHATSAPP SENDER] recovery_accounts_lookup_failed", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

export function platformOtpSender(env: Record<string, string | undefined> = process.env): WhatsAppSender | null {
  const accessToken = String(env.WHATSAPP_OTP_ACCESS_TOKEN || "").trim();
  const phoneNumberId = String(env.WHATSAPP_OTP_PHONE_NUMBER_ID || "").trim();
  const enabled = String(env.WHATSAPP_OTP_ENABLED || "").trim().toLowerCase() === "true";
  if (!enabled || !accessToken || !phoneNumberId) return null;
  return {
    source: "PLATFORM",
    accessToken,
    phoneNumberId,
    languageCode: String(env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || "en").trim() || "en",
    templates: { otp: String(env.WHATSAPP_OTP_TEMPLATE_NAME || "loopd2c_login_otp").trim() || "loopd2c_login_otp" },
  };
}

export function merchantSender(account: MerchantWhatsAppAccountRow | null, decrypt: (value: string) => string | null = decryptShopifyToken): WhatsAppSender | null {
  if (!account?.enabled || !account.phoneNumberId) return null;
  const accessToken = decrypt(account.accessTokenEncrypted);
  if (!accessToken) return null;
  return {
    source: "MERCHANT",
    accessToken,
    phoneNumberId: account.phoneNumberId,
    languageCode: account.templateLanguage || "en",
    templates: { otp: account.otpTemplateName, recoveryFirst: account.recoveryFirstTemplate, recoveryReminder: account.recoveryReminderTemplate },
  };
}

// The sender for one purpose, or null when WhatsApp must not be used for it.
export function chooseWhatsAppSender(
  purpose: WhatsAppPurpose,
  account: MerchantWhatsAppAccountRow | null,
  options: { env?: Record<string, string | undefined>; decrypt?: (value: string) => string | null } = {},
): WhatsAppSender | null {
  const own = merchantSender(account, options.decrypt);
  if (purpose === "otp") return own && account?.otpEnabled ? own : platformOtpSender(options.env);
  if (purpose === "recovery") return own && account?.recoveryEnabled ? own : null;
  return own && account?.exchangeEnabled ? own : null;
}

export async function resolveWhatsAppSender(shopId: string, purpose: WhatsAppPurpose, db?: AccountDb): Promise<WhatsAppSender | null> {
  return chooseWhatsAppSender(purpose, await getMerchantWhatsAppAccount(shopId, db));
}

// ---- Admin form ----

export const WHATSAPP_MASKED_TOKEN = "••••••••";

export class MerchantWhatsAppValidationError extends Error {
  constructor(message: string) { super(message); this.name = "MerchantWhatsAppValidationError"; }
}

export type MerchantWhatsAppAdminView = {
  configured: boolean;
  enabled: boolean;
  displayPhoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessTokenMasked: string;
  templateLanguage: string;
  otpEnabled: boolean;
  otpTemplateName: string;
  recoveryEnabled: boolean;
  recoveryFirstTemplate: string;
  recoveryReminderTemplate: string;
  exchangeEnabled: boolean;
  lastCheckedAt: string | null;
  lastCheckStatus: string | null;
  lastCheckMessage: string | null;
  platformOtpAvailable: boolean;
};

export function toAdminView(account: MerchantWhatsAppAccountRow | null, env: Record<string, string | undefined> = process.env): MerchantWhatsAppAdminView {
  return {
    configured: Boolean(account),
    enabled: account?.enabled ?? false,
    displayPhoneNumber: account?.displayPhoneNumber ?? "",
    phoneNumberId: account?.phoneNumberId ?? "",
    businessAccountId: account?.businessAccountId ?? "",
    accessTokenMasked: account ? WHATSAPP_MASKED_TOKEN : "",
    templateLanguage: account?.templateLanguage ?? "en",
    otpEnabled: account?.otpEnabled ?? true,
    otpTemplateName: account?.otpTemplateName ?? "loopd2c_login_otp",
    recoveryEnabled: account?.recoveryEnabled ?? false,
    recoveryFirstTemplate: account?.recoveryFirstTemplate ?? "checkout_recovery",
    recoveryReminderTemplate: account?.recoveryReminderTemplate ?? "checkout_recovery_reminder",
    exchangeEnabled: account?.exchangeEnabled ?? false,
    lastCheckedAt: account?.lastCheckedAt ? new Date(account.lastCheckedAt).toISOString() : null,
    lastCheckStatus: account?.lastCheckStatus ?? null,
    lastCheckMessage: account?.lastCheckMessage ?? null,
    platformOtpAvailable: Boolean(platformOtpSender(env)),
  };
}

const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
const NUMERIC_ID = /^\d{6,25}$/;

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function flag(value: unknown) { return value === true || value === "on" || value === "true"; }

export type MerchantWhatsAppInput = Record<string, unknown>;

// Validates the admin form. Returns the row data to write; the token is only
// replaced when a new value (not the mask) is entered, and is always stored encrypted.
export function buildMerchantWhatsAppUpdate(
  input: MerchantWhatsAppInput,
  current: MerchantWhatsAppAccountRow | null,
  encrypt: (value: string) => string | null = encryptShopifyToken,
) {
  const phoneNumberId = text(input.phoneNumberId);
  const businessAccountId = text(input.businessAccountId);
  const displayPhoneNumber = text(input.displayPhoneNumber).slice(0, 40);
  const tokenInput = text(input.accessToken);
  const templateLanguage = text(input.templateLanguage) || "en";
  const templates = {
    otpTemplateName: text(input.otpTemplateName) || "loopd2c_login_otp",
    recoveryFirstTemplate: text(input.recoveryFirstTemplate) || "checkout_recovery",
    recoveryReminderTemplate: text(input.recoveryReminderTemplate) || "checkout_recovery_reminder",
  };

  if (!phoneNumberId) throw new MerchantWhatsAppValidationError("Phone number ID is required.");
  if (!NUMERIC_ID.test(phoneNumberId)) throw new MerchantWhatsAppValidationError("Phone number ID must be the numeric ID from Meta's WhatsApp API setup page, not the phone number.");
  if (businessAccountId && !NUMERIC_ID.test(businessAccountId)) throw new MerchantWhatsAppValidationError("WhatsApp Business Account ID must be numeric.");
  if (!LANGUAGE.test(templateLanguage)) throw new MerchantWhatsAppValidationError("Template language must look like en or en_US.");
  for (const [field, value] of Object.entries(templates)) {
    if (!TEMPLATE_NAME.test(value)) throw new MerchantWhatsAppValidationError(`${field} must use lowercase letters, numbers and underscores only.`);
  }

  let accessTokenEncrypted = current?.accessTokenEncrypted ?? "";
  if (tokenInput && tokenInput !== WHATSAPP_MASKED_TOKEN) {
    if (tokenInput.length < 20) throw new MerchantWhatsAppValidationError("Access token looks too short.");
    const encrypted = encrypt(tokenInput);
    if (!encrypted) throw new MerchantWhatsAppValidationError("Cannot store the access token: the server encryption key (TOKEN_ENCRYPTION_KEY) is not configured.");
    accessTokenEncrypted = encrypted;
  }
  if (!accessTokenEncrypted) throw new MerchantWhatsAppValidationError("Access token is required.");

  return {
    enabled: flag(input.enabled),
    displayPhoneNumber: displayPhoneNumber || null,
    phoneNumberId,
    businessAccountId: businessAccountId || null,
    accessTokenEncrypted,
    accessTokenMasked: WHATSAPP_MASKED_TOKEN,
    templateLanguage,
    otpEnabled: flag(input.otpEnabled),
    recoveryEnabled: flag(input.recoveryEnabled),
    exchangeEnabled: flag(input.exchangeEnabled),
    ...templates,
  };
}

// Read-only call to Meta: confirms the token can see the phone number and
// returns its name, number and quality rating. Sends no message.
export async function checkWhatsAppSender(
  sender: Pick<WhatsAppSender, "accessToken" | "phoneNumberId">,
  fetcher: typeof fetch = fetch,
  graphVersion = String(process.env.WHATSAPP_META_GRAPH_VERSION || "v20.0").trim(),
): Promise<{ ok: boolean; message: string }> {
  try {
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(sender.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`;
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${sender.accessToken}` }, cache: "no-store" });
    const data = (await response.json().catch(() => null)) as { display_phone_number?: string; verified_name?: string; quality_rating?: string; error?: { message?: string } } | null;
    if (!response.ok) return { ok: false, message: `Meta rejected the check: ${data?.error?.message || `HTTP ${response.status}`}` };
    return { ok: true, message: `Connected: ${data?.verified_name || "?"} (${data?.display_phone_number || "?"}), quality ${data?.quality_rating || "unknown"}` };
  } catch (error) {
    return { ok: false, message: `Could not reach Meta: ${error instanceof Error ? error.message : String(error)}` };
  }
}
