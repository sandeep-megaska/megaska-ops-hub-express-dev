// Server-only service: import only from server components, server actions, or route handlers.
import { prisma } from "../db/prisma.ts";

type ShopRecord = { id: string; shopDomain: string; shopName: string | null };
type SettingsRecord = Omit<ResolvedMerchantNotificationSettings, "shopId"> & { shopId: string };

export type NotificationSettingsDb = {
  shop: { findUnique(args: { where: { id: string }; select: { id: true; shopDomain: true; shopName: true } }): Promise<ShopRecord | null> };
  merchantNotificationSettings: {
    findUnique(args: { where: { shopId: string } }): Promise<SettingsRecord | null>;
    upsert(args: { where: { shopId: string }; create: SettingsRecord; update: Omit<SettingsRecord, "shopId"> }): Promise<SettingsRecord>;
  };
};

export type ResolvedMerchantNotificationSettings = {
  shopId: string;
  emailEnabled: boolean;
  customerEmailsEnabled: boolean;
  senderDisplayName: string | null;
  replyToEmail: string | null;
  adminRecipients: string[];
  cancellationAlerts: boolean;
  exchangeAlerts: boolean;
  issueAlerts: boolean;
  storeCreditAlerts: boolean;
  checkoutAlerts: boolean;
};


export type MerchantNotificationRoutingSettings = ResolvedMerchantNotificationSettings & {
  hasSettingsRow: boolean;
  shopName: string | null;
};

export type MerchantNotificationSettingsInput = {
  emailEnabled: unknown;
  customerEmailsEnabled: unknown;
  senderDisplayName?: unknown;
  replyToEmail?: unknown;
  adminRecipients: unknown;
  cancellationAlerts: unknown;
  exchangeAlerts: unknown;
  issueAlerts: unknown;
  storeCreditAlerts: unknown;
  checkoutAlerts: unknown;
};

const MAX_RECIPIENTS = 10;
const MAX_EMAIL_LENGTH = 254;
const MAX_SENDER_NAME_LENGTH = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class MerchantNotificationSettingsValidationError extends Error {
  constructor(message: string) { super(message); this.name = "MerchantNotificationSettingsValidationError"; }
}

function log(operation: string, details: Record<string, unknown>) {
  console.info("[MERCHANT NOTIFICATION SETTINGS]", { operation, ...details });
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeAdminRecipients(input: unknown) {
  const raw = Array.isArray(input) ? input.join(",") : String(input || "");
  const values = raw.split(/[\n,]+/).map(normalizeEmail).filter(Boolean);
  const deduped = [...new Map(values.map((email) => [email, email])).values()];
  if (deduped.length > MAX_RECIPIENTS) throw new MerchantNotificationSettingsValidationError(`Enter up to ${MAX_RECIPIENTS} admin recipient email addresses.`);
  for (const email of deduped) {
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) throw new MerchantNotificationSettingsValidationError(`Invalid admin recipient email address: ${email}`);
  }
  return deduped;
}

function normalizeOptionalEmail(input: unknown, label: string) {
  const email = normalizeEmail(String(input || ""));
  if (!email) return null;
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) throw new MerchantNotificationSettingsValidationError(`${label} must be a valid email address.`);
  return email;
}

function normalizeStoredOptionalEmail(input: unknown) {
  try {
    return normalizeOptionalEmail(input, "Reply-to email");
  } catch {
    return null;
  }
}

function normalizeSenderDisplayName(input: unknown) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (value.length > MAX_SENDER_NAME_LENGTH) throw new MerchantNotificationSettingsValidationError(`Sender display name must be ${MAX_SENDER_NAME_LENGTH} characters or fewer.`);
  if (/[\u0000-\u001F\u007F]/.test(value)) throw new MerchantNotificationSettingsValidationError("Sender display name cannot contain control characters.");
  if (EMAIL_RE.test(value)) throw new MerchantNotificationSettingsValidationError("Sender display name must be a name, not an email address.");
  return value;
}

function parseBoolean(input: unknown, field: string) {
  if (typeof input === "boolean") return input;
  if (input === "true" || input === "false") return input === "true";
  throw new MerchantNotificationSettingsValidationError(`${field} must be true or false.`);
}

export function validateMerchantNotificationSettingsInput(input: MerchantNotificationSettingsInput): Omit<ResolvedMerchantNotificationSettings, "shopId"> {
  return {
    emailEnabled: parseBoolean(input.emailEnabled, "Email notifications"),
    customerEmailsEnabled: parseBoolean(input.customerEmailsEnabled, "Customer notification emails"),
    senderDisplayName: normalizeSenderDisplayName(input.senderDisplayName),
    replyToEmail: normalizeOptionalEmail(input.replyToEmail, "Reply-to email"),
    adminRecipients: normalizeAdminRecipients(input.adminRecipients),
    cancellationAlerts: parseBoolean(input.cancellationAlerts, "Cancellation alerts"),
    exchangeAlerts: parseBoolean(input.exchangeAlerts, "Exchange alerts"),
    issueAlerts: parseBoolean(input.issueAlerts, "Issue alerts"),
    storeCreditAlerts: parseBoolean(input.storeCreditAlerts, "Store-credit alerts"),
    checkoutAlerts: parseBoolean(input.checkoutAlerts, "Checkout alerts"),
  };
}

function defaults(shop: ShopRecord): ResolvedMerchantNotificationSettings {
  return { shopId: shop.id, emailEnabled: true, customerEmailsEnabled: true, senderDisplayName: shop.shopName || null, replyToEmail: null, adminRecipients: [], cancellationAlerts: true, exchangeAlerts: true, issueAlerts: true, storeCreditAlerts: true, checkoutAlerts: true };
}

function resolveDb(db?: NotificationSettingsDb) { return (db || prisma) as unknown as NotificationSettingsDb; }

export async function getMerchantNotificationSettings(shopId: string, db?: NotificationSettingsDb): Promise<ResolvedMerchantNotificationSettings> {
  const client = resolveDb(db);
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: { id: true, shopDomain: true, shopName: true } });
  if (!shop) { log("unresolved_shop", { shopId }); throw new Error("Unable to resolve shop notification settings."); }
  const row = await client.merchantNotificationSettings.findUnique({ where: { shopId: shop.id } });
  const resolved = row ? { ...row, adminRecipients: normalizeAdminRecipients(row.adminRecipients), replyToEmail: row.replyToEmail ? normalizeStoredOptionalEmail(row.replyToEmail) : null, senderDisplayName: normalizeSenderDisplayName(row.senderDisplayName) } : defaults(shop);
  log("loaded", { shopId: shop.id, shopDomain: shop.shopDomain, recipientCount: resolved.adminRecipients.length, hasSettingsRow: Boolean(row) });
  return resolved;
}

export async function getMerchantNotificationRoutingSettings(shopId: string, db?: NotificationSettingsDb): Promise<MerchantNotificationRoutingSettings> {
  const client = resolveDb(db);
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: { id: true, shopDomain: true, shopName: true } });
  if (!shop) { log("unresolved_shop", { shopId }); throw new Error("Unable to resolve shop notification routing settings."); }
  const row = await client.merchantNotificationSettings.findUnique({ where: { shopId: shop.id } });
  const resolved = row ? { ...row, adminRecipients: normalizeAdminRecipients(row.adminRecipients), replyToEmail: row.replyToEmail ? normalizeStoredOptionalEmail(row.replyToEmail) : null, senderDisplayName: normalizeSenderDisplayName(row.senderDisplayName) } : defaults(shop);
  log("routing_loaded", { shopId: shop.id, shopDomain: shop.shopDomain, recipientCount: resolved.adminRecipients.length, hasSettingsRow: Boolean(row) });
  return { ...resolved, hasSettingsRow: Boolean(row), shopName: shop.shopName || null };
}

export async function saveMerchantNotificationSettings(shopId: string, input: MerchantNotificationSettingsInput, db?: NotificationSettingsDb): Promise<ResolvedMerchantNotificationSettings> {
  const client = resolveDb(db);
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: { id: true, shopDomain: true, shopName: true } });
  if (!shop) { log("unresolved_shop", { shopId }); throw new Error("Unable to resolve shop notification settings."); }
  let data: Omit<ResolvedMerchantNotificationSettings, "shopId">;
  try { data = validateMerchantNotificationSettingsInput(input); }
  catch (error) { log("validation_rejected", { shopId: shop.id, shopDomain: shop.shopDomain }); throw error; }
  const existed = await client.merchantNotificationSettings.findUnique({ where: { shopId: shop.id } });
  const saved = await client.merchantNotificationSettings.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, ...data }, update: data });
  log(existed ? "updated" : "created", { shopId: shop.id, shopDomain: shop.shopDomain, recipientCount: data.adminRecipients.length });
  return { ...saved, adminRecipients: normalizeAdminRecipients(saved.adminRecipients) };
}
