// WhatsApp inbox: stores customer messages from the webhook, outbound messages
// (inbox replies and automated templates, never OTP codes) and delivery status,
// and sends free-form replies from the admin inbox.
//
// WhatsApp only allows free-form replies within 24 hours of the customer's last
// message ("customer service window"); outside it only approved templates can
// be sent, so the inbox blocks the reply and says why.

import { normalizeWhatsAppPhone } from "./consent.ts";
import { merchantSender, type MerchantWhatsAppAccountRow, type WhatsAppSender } from "./sender.ts";

export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;
// A new message after this much quiet emails the team (a "new chat" alert).
export const NEW_CHAT_ALERT_GAP_MS = 2 * 60 * 60 * 1000;
const MAX_TEXT = 4096;

export type InboundMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { id?: string; caption?: string };
  video?: { id?: string; caption?: string };
  document?: { id?: string; caption?: string; filename?: string };
  audio?: { id?: string };
  sticker?: { id?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string } }>;
  reaction?: { emoji?: string };
};

export type WebhookValue = {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: InboundMessage[];
  statuses?: Array<{ id?: string; status?: string; errors?: Array<{ code?: number; title?: string; message?: string }> }>;
};

// Text shown in the inbox for any message type, plus the media id when there is one.
export function describeInbound(message: InboundMessage): { type: string; body: string; mediaId: string | null } {
  const type = message.type || "unknown";
  switch (type) {
    case "text": return { type, body: message.text?.body || "", mediaId: null };
    case "button": return { type, body: message.button?.text || message.button?.payload || "", mediaId: null };
    case "interactive": return { type, body: message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "", mediaId: null };
    case "image": return { type, body: message.image?.caption || "📷 Photo", mediaId: message.image?.id || null };
    case "video": return { type, body: message.video?.caption || "🎥 Video", mediaId: message.video?.id || null };
    case "document": return { type, body: message.document?.caption || `📄 ${message.document?.filename || "Document"}`, mediaId: message.document?.id || null };
    case "audio": return { type, body: "🎤 Voice message", mediaId: message.audio?.id || null };
    case "sticker": return { type, body: "Sticker", mediaId: message.sticker?.id || null };
    case "location": return { type, body: `📍 ${[message.location?.name, message.location?.address].filter(Boolean).join(", ") || `${message.location?.latitude}, ${message.location?.longitude}`}`, mediaId: null };
    case "contacts": return { type, body: `👤 ${message.contacts?.[0]?.name?.formatted_name || "Contact card"}`, mediaId: null };
    case "reaction": return { type, body: `Reacted ${message.reaction?.emoji || ""}`.trim(), mediaId: null };
    default: return { type, body: `Unsupported message (${type})`, mediaId: null };
  }
}

export function isWithinCustomerWindow(lastInboundAt: Date | null | undefined, now = new Date()) {
  return Boolean(lastInboundAt && now.getTime() - new Date(lastInboundAt).getTime() < CUSTOMER_WINDOW_MS);
}

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

// Webhooks can arrive out of order; never move a message "backwards" (read -> delivered).
export function nextStatus(current: string | null | undefined, incoming: string | null | undefined) {
  if (!incoming || !(incoming in STATUS_RANK)) return current ?? null;
  if (!current || !(current in STATUS_RANK)) return incoming;
  return STATUS_RANK[incoming] >= STATUS_RANK[current] ? incoming : current;
}

type Conversation = { id: string; shopId: string; businessPhoneNumberId: string; contactPhone: string; contactName: string | null; lastInboundAt: Date | null };

export type InboxDb = {
  merchantWhatsAppAccount: { findFirst(args: unknown): Promise<MerchantWhatsAppAccountRow | null>; findUnique(args: unknown): Promise<MerchantWhatsAppAccountRow | null> };
  shop: { findUnique(args: unknown): Promise<{ id: string; shopDomain: string } | null> };
  whatsAppConversation: {
    findUnique(args: unknown): Promise<Conversation | null>;
    findFirst(args: unknown): Promise<Conversation | null>;
    upsert(args: unknown): Promise<Conversation>;
    update(args: unknown): Promise<Conversation>;
  };
  whatsAppMessage: {
    findUnique(args: unknown): Promise<{ id: string; status: string | null } | null>;
    findFirst(args: unknown): Promise<{ waMessageId: string | null } | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};

async function defaultDb(): Promise<InboxDb> {
  return (await import("../db/prisma.ts")).prisma as unknown as InboxDb;
}

type AlertFn = (input: { shopId: string; subject: string; text: string }) => Promise<unknown>;
const defaultAlert: AlertFn = async (input) => {
  const { sendOpsAlert } = await import("../notifications/email.ts");
  return sendOpsAlert({ shopId: input.shopId, eventType: "GENERAL", subject: input.subject, text: input.text });
};

function inboxUrl(shopDomain: string, conversationId: string) {
  const base = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  return base ? `${base}/admin/whatsapp/${conversationId}?shop=${encodeURIComponent(shopDomain)}` : "Open LoopD2C → WhatsApp Inbox";
}

// Stores the customer messages in one webhook change. Returns how many were stored.
export async function recordInboundMessages(value: WebhookValue, deps: { db?: InboxDb; alert?: AlertFn; now?: Date } = {}) {
  const businessPhoneNumberId = String(value.metadata?.phone_number_id || "");
  const messages = value.messages || [];
  if (!businessPhoneNumberId || !messages.length) return 0;
  const db = deps.db ?? (await defaultDb());
  const account = await db.merchantWhatsAppAccount.findFirst({ where: { phoneNumberId: businessPhoneNumberId } });
  if (!account) {
    console.info("[WHATSAPP INBOX] inbound_unmapped_number", { businessPhoneNumberId, count: messages.length });
    return 0;
  }
  const alert = deps.alert ?? defaultAlert;
  let stored = 0;
  for (const message of messages) {
    const contactPhone = normalizeWhatsAppPhone(message.from);
    if (!contactPhone || !message.id) continue;
    if (await db.whatsAppMessage.findUnique({ where: { waMessageId: message.id } })) continue;
    const at = message.timestamp ? new Date(Number(message.timestamp) * 1000) : deps.now ?? new Date();
    const profileName = value.contacts?.find((contact) => normalizeWhatsAppPhone(contact.wa_id) === contactPhone)?.profile?.name || null;
    const content = describeInbound(message);
    const previous = await db.whatsAppConversation.findUnique({ where: { businessPhoneNumberId_contactPhone: { businessPhoneNumberId, contactPhone } } });
    const conversation = await db.whatsAppConversation.upsert({
      where: { businessPhoneNumberId_contactPhone: { businessPhoneNumberId, contactPhone } },
      create: { shopId: account.shopId, businessPhoneNumberId, contactPhone, contactName: profileName, lastMessageAt: at, lastMessagePreview: content.body.slice(0, 200), lastInboundAt: at, unreadCount: 1 },
      update: { ...(profileName ? { contactName: profileName } : {}), lastMessageAt: at, lastMessagePreview: content.body.slice(0, 200), lastInboundAt: at, unreadCount: { increment: 1 } },
    });
    try {
      await db.whatsAppMessage.create({ data: { conversationId: conversation.id, direction: "INBOUND", waMessageId: message.id, type: content.type, body: content.body.slice(0, MAX_TEXT), mediaId: content.mediaId, createdAt: at } });
      stored += 1;
    } catch {
      continue; // duplicate delivery raced us
    }
    const quietFor = previous?.lastInboundAt ? at.getTime() - new Date(previous.lastInboundAt).getTime() : Infinity;
    if (quietFor >= NEW_CHAT_ALERT_GAP_MS) {
      const shop = await db.shop.findUnique({ where: { id: account.shopId }, select: { id: true, shopDomain: true } });
      const who = conversation.contactName || profileName || `+${contactPhone}`;
      await alert({
        shopId: account.shopId,
        subject: `New WhatsApp message from ${who}`,
        text: [`${who} (+${contactPhone}) wrote on WhatsApp:`, "", content.body.slice(0, 500), "", `Reply within 24 hours: ${inboxUrl(shop?.shopDomain || "", conversation.id)}`].join("\n"),
      }).catch(() => undefined);
    }
  }
  return stored;
}

export async function applyStatusUpdates(value: WebhookValue, deps: { db?: InboxDb } = {}) {
  const statuses = value.statuses || [];
  if (!statuses.length) return 0;
  const db = deps.db ?? (await defaultDb());
  let updated = 0;
  for (const status of statuses) {
    if (!status.id || !status.status) continue;
    const message = await db.whatsAppMessage.findUnique({ where: { waMessageId: status.id } });
    if (!message) continue;
    const next = nextStatus(message.status, status.status);
    if (next === message.status) continue;
    const error = status.status === "failed" ? (status.errors || []).map((e) => `${e.code ?? ""} ${e.title || e.message || ""}`.trim()).join("; ").slice(0, 500) || "failed" : undefined;
    await db.whatsAppMessage.update({ where: { id: message.id }, data: { status: next, ...(error ? { errorMessage: error } : {}) } });
    updated += 1;
  }
  return updated;
}

// Records a message LoopD2C sent (inbox reply or automated template) in the thread.
export async function recordOutboundMessage(
  input: { shopId: string; businessPhoneNumberId: string; toPhone: string; waMessageId: string | null; type: string; body: string; templateName?: string | null; sentByEmail?: string | null; now?: Date },
  deps: { db?: InboxDb } = {},
) {
  const contactPhone = normalizeWhatsAppPhone(input.toPhone);
  if (!contactPhone || !input.businessPhoneNumberId) return;
  const db = deps.db ?? (await defaultDb());
  const at = input.now ?? new Date();
  const conversation = await db.whatsAppConversation.upsert({
    where: { businessPhoneNumberId_contactPhone: { businessPhoneNumberId: input.businessPhoneNumberId, contactPhone } },
    create: { shopId: input.shopId, businessPhoneNumberId: input.businessPhoneNumberId, contactPhone, lastMessageAt: at, lastMessagePreview: input.body.slice(0, 200) },
    update: { lastMessageAt: at, lastMessagePreview: input.body.slice(0, 200) },
  });
  await db.whatsAppMessage.create({ data: { conversationId: conversation.id, direction: "OUTBOUND", waMessageId: input.waMessageId, type: input.type, body: input.body.slice(0, MAX_TEXT), templateName: input.templateName ?? null, status: "sent", sentByEmail: input.sentByEmail ?? null, createdAt: at } });
}

export class InboxReplyError extends Error {
  constructor(message: string) { super(message); this.name = "InboxReplyError"; }
}

type Fetcher = typeof fetch;

function graphVersion() {
  return String(process.env.WHATSAPP_META_GRAPH_VERSION || "v20.0").trim().replace(/^\/+|\/+$/g, "");
}

async function senderForShop(db: InboxDb, shopId: string, businessPhoneNumberId: string): Promise<WhatsAppSender> {
  const account = await db.merchantWhatsAppAccount.findUnique({ where: { shopId } });
  const sender = merchantSender(account);
  if (!sender) throw new InboxReplyError("Your WhatsApp number is not connected or is switched off (Merchant Settings → WhatsApp).");
  if (sender.phoneNumberId !== businessPhoneNumberId) throw new InboxReplyError("This conversation belongs to a WhatsApp number that is no longer connected.");
  return sender;
}

// Sends a free-form text reply from the admin inbox.
export async function sendInboxReply(input: { shopId: string; conversationId: string; text: string; sentByEmail?: string | null; now?: Date }, deps: { db?: InboxDb; fetcher?: Fetcher } = {}) {
  const text = String(input.text || "").trim();
  if (!text) throw new InboxReplyError("Type a message first.");
  if (text.length > MAX_TEXT) throw new InboxReplyError(`Messages can be at most ${MAX_TEXT} characters.`);
  const db = deps.db ?? (await defaultDb());
  const conversation = await db.whatsAppConversation.findFirst({ where: { id: input.conversationId, shopId: input.shopId } });
  if (!conversation) throw new InboxReplyError("Conversation not found.");
  if (!isWithinCustomerWindow(conversation.lastInboundAt, input.now)) {
    throw new InboxReplyError("More than 24 hours since the customer's last message. WhatsApp only allows approved templates now; the customer needs to message you first.");
  }
  const sender = await senderForShop(db, input.shopId, conversation.businessPhoneNumberId);
  const response = await (deps.fetcher ?? fetch)(`https://graph.facebook.com/${graphVersion()}/${sender.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sender.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: conversation.contactPhone, type: "text", text: { preview_url: true, body: text } }),
  });
  const data = (await response.json().catch(() => null)) as { messages?: Array<{ id?: string }>; error?: { message?: string } } | null;
  if (!response.ok) throw new InboxReplyError(`WhatsApp did not accept the message: ${data?.error?.message || `HTTP ${response.status}`}`);
  await recordOutboundMessage({ shopId: input.shopId, businessPhoneNumberId: sender.phoneNumberId, toPhone: conversation.contactPhone, waMessageId: data?.messages?.[0]?.id || null, type: "text", body: text, sentByEmail: input.sentByEmail, now: input.now }, { db });
}

// Clears the unread count and sends a read receipt (blue ticks) for the latest customer message.
export async function markConversationRead(input: { shopId: string; conversationId: string }, deps: { db?: InboxDb; fetcher?: Fetcher } = {}) {
  const db = deps.db ?? (await defaultDb());
  const conversation = await db.whatsAppConversation.findFirst({ where: { id: input.conversationId, shopId: input.shopId } });
  if (!conversation) return;
  await db.whatsAppConversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
  try {
    const latest = await db.whatsAppMessage.findFirst({ where: { conversationId: conversation.id, direction: "INBOUND" }, orderBy: { createdAt: "desc" }, select: { waMessageId: true } });
    if (!latest?.waMessageId) return;
    const sender = await senderForShop(db, input.shopId, conversation.businessPhoneNumberId);
    await (deps.fetcher ?? fetch)(`https://graph.facebook.com/${graphVersion()}/${sender.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sender.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: latest.waMessageId }),
    });
  } catch {
    // Read receipts are best-effort.
  }
}

// Downloads a customer's photo/voice note/document through Meta (media URLs need the token).
export async function fetchInboxMedia(input: { shopId: string; mediaId: string }, deps: { db?: InboxDb; fetcher?: Fetcher } = {}) {
  const db = deps.db ?? (await defaultDb());
  const account = await db.merchantWhatsAppAccount.findUnique({ where: { shopId: input.shopId } });
  const sender = merchantSender(account ? { ...account, enabled: true } : null);
  if (!sender) return null;
  const fetcher = deps.fetcher ?? fetch;
  const meta = await fetcher(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(input.mediaId)}?phone_number_id=${encodeURIComponent(sender.phoneNumberId)}`, { headers: { Authorization: `Bearer ${sender.accessToken}` } });
  if (!meta.ok) return null;
  const info = (await meta.json().catch(() => null)) as { url?: string; mime_type?: string } | null;
  if (!info?.url) return null;
  const file = await fetcher(info.url, { headers: { Authorization: `Bearer ${sender.accessToken}` } });
  if (!file.ok) return null;
  return { body: await file.arrayBuffer(), contentType: info.mime_type || file.headers.get("content-type") || "application/octet-stream" };
}
