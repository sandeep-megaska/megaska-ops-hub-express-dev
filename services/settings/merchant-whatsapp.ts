// Server-only: the merchant's own WhatsApp number (Merchant Settings → WhatsApp).
import { prisma } from "../db/prisma.ts";
import {
  buildMerchantWhatsAppUpdate,
  checkWhatsAppSender,
  getMerchantWhatsAppAccount,
  merchantSender,
  toAdminView,
  type MerchantWhatsAppAccountRow,
  type MerchantWhatsAppAdminView,
  type MerchantWhatsAppInput,
} from "../whatsapp/sender.ts";

type AccountDb = {
  merchantWhatsAppAccount: {
    findUnique(args: { where: { shopId: string } }): Promise<MerchantWhatsAppAccountRow | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<MerchantWhatsAppAccountRow[]>;
    upsert(args: { where: { shopId: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<MerchantWhatsAppAccountRow>;
    update(args: { where: { shopId: string }; data: Record<string, unknown> }): Promise<MerchantWhatsAppAccountRow>;
  };
};

function db() { return prisma as unknown as AccountDb; }

export async function getMerchantWhatsAppAdmin(shopId: string): Promise<MerchantWhatsAppAdminView> {
  return toAdminView(await getMerchantWhatsAppAccount(shopId, db()));
}

export async function saveMerchantWhatsApp(shopId: string, input: MerchantWhatsAppInput) {
  const current = await getMerchantWhatsAppAccount(shopId, db());
  const data = buildMerchantWhatsAppUpdate(input, current);
  await db().merchantWhatsAppAccount.upsert({ where: { shopId }, create: { shopId, ...data }, update: data });
  console.info("[MERCHANT WHATSAPP SETTINGS]", { operation: "saved", shopId, enabled: data.enabled, otpEnabled: data.otpEnabled, recoveryEnabled: data.recoveryEnabled, exchangeEnabled: data.exchangeEnabled });
}

// Read-only connection check against Meta; the result is stored and shown in the form.
export async function checkMerchantWhatsApp(shopId: string) {
  const account = await getMerchantWhatsAppAccount(shopId, db());
  if (!account) return { ok: false, message: "Save the WhatsApp settings first." };
  const sender = merchantSender({ ...account, enabled: true });
  const result = sender ? await checkWhatsAppSender(sender) : { ok: false, message: "The saved access token cannot be read. Enter it again and save." };
  await db().merchantWhatsAppAccount.update({ where: { shopId }, data: { lastCheckedAt: new Date(), lastCheckStatus: result.ok ? "OK" : "ERROR", lastCheckMessage: result.message.slice(0, 500) } });
  return result;
}

// Submits the exchange-update templates to Meta from the shop's own WhatsApp Business Account
// (skipping any already there) and says where they stand.
export async function setUpExchangeTemplates(shopId: string) {
  const account = await getMerchantWhatsAppAccount(shopId, db());
  if (!account) return { ok: false, message: "Save the WhatsApp settings first." };
  if (!account.businessAccountId) return { ok: false, message: "Add the WhatsApp Business Account ID first (Meta → WhatsApp → API setup), then try again." };
  const sender = merchantSender({ ...account, enabled: true });
  if (!sender) return { ok: false, message: "The saved access token cannot be read. Enter it again and save." };
  const { submitExchangeTemplates, templateSetupSummary } = await import("../whatsapp/exchange-templates.ts");
  try {
    const result = await submitExchangeTemplates({ wabaId: account.businessAccountId, accessToken: sender.accessToken, language: account.templateLanguage || "en" });
    console.info("[MERCHANT WHATSAPP SETTINGS]", { operation: "exchange_templates", shopId, created: result.created.length, existing: result.existing.length, failed: result.failed.length });
    return { ok: result.failed.length === 0, message: templateSetupSummary(result) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message.slice(0, 300) : "Could not reach Meta." };
  }
}
