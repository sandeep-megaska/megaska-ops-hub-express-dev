// WhatsApp recovery for abandoned native Shopify checkouts.
//
// Exactly two messages per abandoned checkout, never more:
//   1. "first"    — once the checkout has been idle 15 minutes. The cron runs
//                   every 15 minutes, so it lands 15–30 minutes after the shopper left.
//   2. "reminder" — 24 hours after the first, if they still have not ordered.
// On top of that a phone gets at most two recovery messages from a shop in any 7
// days, so a shopper who abandons several checkouts is not messaged more.
//
// Only checkouts whose phone was verified by the OTP gate qualify, the shopper
// must not have ordered since the checkout began, and a WhatsApp opt-out (STOP)
// stops everything. The link rebuilds the same bag in the storefront drawer,
// where the shopper picks Pay online or Cash on Delivery.
//
// Runs only for shops with their own WhatsApp number and recovery switched on
// (MerchantWhatsAppAccount), and always sends from that shop's own number.

import { createCodRecoveryToken, type RecoveryItem } from "./prepaid-cod-recovery.ts";
import { listRecoveryWhatsAppAccounts, merchantSender, type MerchantWhatsAppAccountRow, type WhatsAppSender } from "../whatsapp/sender.ts";

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;

const defaultGraphql: Graphql = async (query, variables, options) =>
  ((await import("../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options);

export const WHATSAPP_RECOVERY_EVENT = "WHATSAPP_CHECKOUT_RECOVERY_SENT";
const ENTITY_TYPE = "SHOPIFY_ABANDONED_CHECKOUT_WHATSAPP";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const FIRST_MESSAGE_IDLE_MS = 15 * MINUTE;
// A first message that could not go out within this window is skipped rather than sent late.
export const FIRST_MESSAGE_MAX_IDLE_MS = 6 * HOUR;
export const REMINDER_DELAY_MS = 24 * HOUR;
// A reminder that could not go out within this window after the first is dropped.
export const REMINDER_MAX_DELAY_MS = 30 * HOUR;
const LOOKBACK_MS = 48 * HOUR;
export const PHONE_WINDOW_MS = 7 * 24 * HOUR;
export const MAX_MESSAGES_PER_PHONE = 2;
// A new "first" message never follows another recovery message to the same phone this soon.
export const PHONE_FIRST_MESSAGE_GAP_MS = 24 * HOUR;
const MAX_ITEMS = 20;

const ABANDONED_CHECKOUTS_QUERY = `query WhatsAppAbandonedCheckouts($query: String!, $after: String) {
  abandonedCheckouts(first: 50, after: $after, reverse: true, query: $query) {
    nodes {
      id
      createdAt
      updatedAt
      completedAt
      customAttributes { key value }
      customer { lastOrder { createdAt } }
      lineItems(first: 20) { nodes { quantity variant { id } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export type AbandonedCheckoutNode = {
  id?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  customAttributes?: Array<{ key?: string | null; value?: string | null }> | null;
  customer?: { lastOrder?: { createdAt?: string | null } | null } | null;
  lineItems?: { nodes?: Array<{ quantity?: number | null; variant?: { id?: string | null } | null }> | null } | null;
};

export type WhatsAppRecoveryCheckout = {
  checkoutId: string;
  phone: string;
  createdAt: number;
  updatedAt: number;
  items: RecoveryItem[];
};

export type RecoveryStep = "first" | "reminder";

export type SentRecord = { step: RecoveryStep; sentAt: number };

function attribute(node: AbandonedCheckoutNode, key: string) {
  const match = (node.customAttributes ?? []).find((entry) => entry?.key === key);
  return String(match?.value ?? "").trim();
}

function numericId(gid: string | null | undefined): number | null {
  const match = String(gid ?? "").match(/(\d+)$/);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

// Abandoned, OTP-verified checkouts with a phone and items, where the shopper
// has not ordered since the checkout began. One checkout per phone (the most
// recently updated): a shopper with two open checkouts gets one message
// thread, not one per checkout.
export function selectRecoverableCheckouts(nodes: AbandonedCheckoutNode[]): WhatsAppRecoveryCheckout[] {
  const latestByPhone = new Map<string, WhatsAppRecoveryCheckout>();
  for (const checkout of eligibleCheckouts(nodes)) {
    const current = latestByPhone.get(checkout.phone);
    if (!current || checkout.updatedAt > current.updatedAt) latestByPhone.set(checkout.phone, checkout);
  }
  return [...latestByPhone.values()];
}

function eligibleCheckouts(nodes: AbandonedCheckoutNode[]): WhatsAppRecoveryCheckout[] {
  const out: WhatsAppRecoveryCheckout[] = [];
  for (const node of nodes) {
    if (!node?.id || node.completedAt) continue;
    const createdAt = node.createdAt ? new Date(node.createdAt).getTime() : NaN;
    const updatedAt = node.updatedAt ? new Date(node.updatedAt).getTime() : createdAt;
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) continue;
    if (attribute(node, "megaska_phone_verified").toLowerCase() !== "true") continue;
    const phone = normalizePhone(attribute(node, "megaska_verified_phone"));
    if (!phone) continue;
    const lastOrderAt = node.customer?.lastOrder?.createdAt ? new Date(node.customer.lastOrder.createdAt).getTime() : NaN;
    if (Number.isFinite(lastOrderAt) && lastOrderAt >= createdAt) continue;
    const items = (node.lineItems?.nodes ?? [])
      .map((line) => ({ variantId: numericId(line?.variant?.id), quantity: Math.max(0, Math.floor(Number(line?.quantity ?? 0))) }))
      .filter((line): line is RecoveryItem => line.variantId !== null && line.quantity > 0)
      .slice(0, MAX_ITEMS);
    if (!items.length) continue;
    out.push({ checkoutId: node.id, phone, createdAt, updatedAt, items });
  }
  return out;
}

// Which message (if any) is due for this checkout now. `sent` holds the messages
// already sent for this checkout; `phoneSendsInWindow` counts recovery messages
// to this phone in the last 7 days across all checkouts.
export function dueStep(checkout: WhatsAppRecoveryCheckout, sent: SentRecord[], phoneSendsInWindow: number, now: number): RecoveryStep | null {
  if (phoneSendsInWindow >= MAX_MESSAGES_PER_PHONE) return null;
  const idle = now - checkout.updatedAt;
  if (idle < FIRST_MESSAGE_IDLE_MS) return null;
  const first = sent.find((record) => record.step === "first");
  if (!first) return idle <= FIRST_MESSAGE_MAX_IDLE_MS ? "first" : null;
  if (sent.some((record) => record.step === "reminder")) return null;
  const sinceFirst = now - first.sentAt;
  return sinceFirst >= REMINDER_DELAY_MS && sinceFirst <= REMINDER_MAX_DELAY_MS ? "reminder" : null;
}

export async function listRecentAbandonedCheckouts(input: { shopDomain: string; now: Date }, graphql: Graphql = defaultGraphql) {
  const since = new Date(input.now.getTime() - LOOKBACK_MS).toISOString();
  const nodes: AbandonedCheckoutNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const data: { abandonedCheckouts: { nodes: AbandonedCheckoutNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await graphql(ABANDONED_CHECKOUTS_QUERY, { query: `updated_at:>='${since}'`, after }, { shopDomain: input.shopDomain });
    nodes.push(...(data.abandonedCheckouts?.nodes ?? []));
    if (!data.abandonedCheckouts?.pageInfo?.hasNextPage) break;
    after = data.abandonedCheckouts.pageInfo.endCursor;
  }
  return nodes;
}

type RecoveryEvent = { entityId: string | null; createdAt: Date; payload: unknown };

type RecoveryDb = {
  shop: { findMany(args: unknown): Promise<Array<{ id: string; shopDomain: string }>> };
  auditEvent: {
    findMany(args: unknown): Promise<RecoveryEvent[]>;
    create(args: unknown): Promise<unknown>;
  };
};

type SendTemplate = (input: { sender: WhatsAppSender; shopId: string; toPhone: string; templateName: string; languageCode: string; token: string; checkoutId: string }) => Promise<{ success: boolean; messageId?: string | null }>;

const defaultSendTemplate: SendTemplate = async (input) => {
  const { sendTemplateMessage } = await import("../whatsapp/index.ts");
  return sendTemplateMessage({
    sender: input.sender,
    shopId: input.shopId,
    toPhone: input.toPhone,
    templateName: input.templateName,
    languageCode: input.languageCode,
    recoveryType: "CHECKOUT_ABANDONMENT",
    // Template button: https://<store>/apps/loopd2c/checkout/bag?t={{1}}
    components: [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: input.token }] }],
  });
};

const defaultIsOptedOut = async (phone: string, senderPhoneNumberId: string) => (await import("../whatsapp/consent.ts")).isWhatsAppOptedOut(phone, senderPhoneNumberId);

export type WhatsAppRecoverySummary = { enabled: boolean; shops: number; candidates: number; sentFirst: number; sentReminder: number; skippedOptOut: number; failed: number };

function eventStep(event: RecoveryEvent): RecoveryStep | null {
  const step = (event.payload as { step?: unknown } | null)?.step;
  return step === "first" || step === "reminder" ? step : null;
}

// Runs for every shop whose own WhatsApp number has recovery switched on
// (admin: Merchant Settings → WhatsApp). CHECKOUT_RECOVERY_SIGNING_SECRET
// (32+ chars) signs the bag links.
export async function runWhatsAppCheckoutRecovery(
  input: { now?: Date; maxSends?: number },
  dependencies: { db?: RecoveryDb; listAccounts?: () => Promise<MerchantWhatsAppAccountRow[]>; senderFor?: (account: MerchantWhatsAppAccountRow) => WhatsAppSender | null; listCheckouts?: typeof listRecentAbandonedCheckouts; sendTemplate?: SendTemplate; isOptedOut?: (phone: string, senderPhoneNumberId: string) => Promise<boolean>; env?: Record<string, string | undefined> } = {},
): Promise<WhatsAppRecoverySummary> {
  const now = input.now ?? new Date();
  const env = dependencies.env ?? process.env;
  const secret = String(env.CHECKOUT_RECOVERY_SIGNING_SECRET ?? "").trim();
  const summary: WhatsAppRecoverySummary = { enabled: secret.length >= 32, shops: 0, candidates: 0, sentFirst: 0, sentReminder: 0, skippedOptOut: 0, failed: 0 };
  if (!summary.enabled) return summary;

  const accounts = await (dependencies.listAccounts ?? listRecoveryWhatsAppAccounts)();
  if (!accounts.length) return summary;
  const senderFor = dependencies.senderFor ?? ((account: MerchantWhatsAppAccountRow) => merchantSender(account));
  const db = dependencies.db ?? ((await import("../db/prisma.ts")).prisma as unknown as RecoveryDb);
  const listCheckouts = dependencies.listCheckouts ?? listRecentAbandonedCheckouts;
  const sendTemplate = dependencies.sendTemplate ?? defaultSendTemplate;
  const isOptedOut = dependencies.isOptedOut ?? defaultIsOptedOut;
  let budget = input.maxSends ?? 30;

  const shops = await db.shop.findMany({ where: { id: { in: accounts.map((account) => account.shopId) } }, select: { id: true, shopDomain: true } });
  for (const shop of shops) {
    const account = accounts.find((row) => row.shopId === shop.id);
    const sender = account ? senderFor(account) : null;
    if (!sender) { summary.failed += 1; continue; }
    const templates: Record<RecoveryStep, string> = {
      first: sender.templates.recoveryFirst || "checkout_recovery",
      reminder: sender.templates.recoveryReminder || "checkout_recovery_reminder",
    };
    summary.shops += 1;
    let checkouts: WhatsAppRecoveryCheckout[];
    try {
      checkouts = selectRecoverableCheckouts(await listCheckouts({ shopDomain: shop.shopDomain, now }));
    } catch {
      summary.failed += 1;
      continue;
    }
    summary.candidates += checkouts.length;
    if (!checkouts.length) continue;

    // Everything sent to these phones in the last 7 days, in one query.
    const phones = [...new Set(checkouts.map((checkout) => checkout.phone))];
    const recent = await db.auditEvent.findMany({
      where: { eventType: WHATSAPP_RECOVERY_EVENT, entityType: ENTITY_TYPE, createdAt: { gte: new Date(now.getTime() - PHONE_WINDOW_MS) }, AND: [{ payload: { path: ["shopId"], equals: shop.id } }, { OR: phones.map((phone) => ({ payload: { path: ["phone"], equals: phone } })) }] },
      select: { entityId: true, createdAt: true, payload: true },
    });
    const sendsByPhone = new Map<string, number>();
    const lastSentByPhone = new Map<string, number>();
    for (const event of recent) {
      const phone = String((event.payload as { phone?: unknown } | null)?.phone ?? "");
      sendsByPhone.set(phone, (sendsByPhone.get(phone) ?? 0) + 1);
      lastSentByPhone.set(phone, Math.max(lastSentByPhone.get(phone) ?? 0, new Date(event.createdAt).getTime()));
    }

    for (const checkout of checkouts) {
      if (budget <= 0) break;
      const sent = recent
        .filter((event) => event.entityId === checkout.checkoutId)
        .map((event) => ({ step: eventStep(event), sentAt: new Date(event.createdAt).getTime() }))
        .filter((record): record is SentRecord => record.step !== null);
      const step = dueStep(checkout, sent, sendsByPhone.get(checkout.phone) ?? 0, now.getTime());
      if (!step) continue;
      if (step === "first" && now.getTime() - (lastSentByPhone.get(checkout.phone) ?? 0) < PHONE_FIRST_MESSAGE_GAP_MS) continue;
      if (await isOptedOut(checkout.phone, sender.phoneNumberId)) { summary.skippedOptOut += 1; continue; }
      budget -= 1;
      const token = createCodRecoveryToken({ shopId: shop.id, checkoutId: checkout.checkoutId, items: checkout.items, now }, secret);
      try {
        const result = await sendTemplate({ sender, shopId: shop.id, toPhone: checkout.phone, templateName: templates[step], languageCode: sender.languageCode, token, checkoutId: checkout.checkoutId });
        if (!result.success) { summary.failed += 1; continue; }
        // Recorded only after Meta accepted the message; a failed send is retried next run.
        await db.auditEvent.create({ data: { actorType: "system", eventType: WHATSAPP_RECOVERY_EVENT, entityType: ENTITY_TYPE, entityId: checkout.checkoutId, payload: { shopId: shop.id, step, phone: checkout.phone, templateName: templates[step], messageId: result.messageId ?? null } } });
        sendsByPhone.set(checkout.phone, (sendsByPhone.get(checkout.phone) ?? 0) + 1);
        lastSentByPhone.set(checkout.phone, now.getTime());
        if (step === "first") summary.sentFirst += 1; else summary.sentReminder += 1;
      } catch {
        summary.failed += 1;
      }
    }
  }
  return summary;
}
