// WhatsApp COD order confirmation.
//
// A few minutes after a cash-on-delivery order, the shop's own WhatsApp number
// sends a Utility template with two Quick reply buttons, Confirm order and
// Cancel order (payloads `codc:confirm:<order id>` / `codc:cancel:<order id>`).
// - Confirm → Shopify tag `cod-confirmed` and a thank-you message.
// - Cancel  → tag `cod-cancel-requested`, the chat is flagged for the team and
//             they are emailed. Nothing is cancelled automatically.
// - No reply in 12 hours → tag `cod-no-response`, so the team can call before
//             shipping. No second message is sent.
// A reply only counts when it comes from a phone number on that order.
//
// Sends run from the 15-minute checkout-recovery cron; replies arrive through
// the WhatsApp webhook. Every step is recorded as an AuditEvent on the order.

import { normalizeWhatsAppPhone } from "../whatsapp/consent.ts";
import type { MerchantWhatsAppAccountRow, WhatsAppSender } from "../whatsapp/sender.ts";

export const COD_CONFIRMATION_SENT_EVENT = "WHATSAPP_COD_CONFIRMATION_SENT";
export const COD_CONFIRMATION_RESPONSE_EVENT = "WHATSAPP_COD_CONFIRMATION_RESPONSE";
export const COD_ENTITY_TYPE = "ShopifyOrder";
export const COD_TAGS = { confirmed: "cod-confirmed", cancelRequested: "cod-cancel-requested", noResponse: "cod-no-response" } as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Wait a little after checkout so order edits and fraud checks settle.
export const COD_SEND_MIN_AGE_MS = 3 * MINUTE;
// Orders older than this when the feature first sees them are left alone.
export const COD_SEND_MAX_AGE_MS = 6 * HOUR;
export const COD_NO_RESPONSE_AFTER_MS = 12 * HOUR;
const EVENT_LOOKBACK_MS = 3 * 24 * HOUR;
const MAX_SENDS_PER_RUN = 40;

export type CodResponse = "confirmed" | "cancel_requested" | "no_response";

type Money = { amount?: string | null; currencyCode?: string | null } | null | undefined;
export type CodOrderNode = {
  id?: string | null;
  name?: string | null;
  createdAt?: string | null;
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string | null;
  paymentGatewayNames?: string[] | null;
  tags?: string[] | null;
  phone?: string | null;
  totalPriceSet?: { shopMoney?: Money } | null;
  customer?: { firstName?: string | null; defaultPhoneNumber?: { phoneNumber?: string | null } | null } | null;
  shippingAddress?: { firstName?: string | null; phone?: string | null } | null;
  customAttributes?: Array<{ key?: string | null; value?: string | null }> | null;
};

export type CodOrder = { orderId: string; orderName: string; phone: string; firstName: string; total: string; createdAt: number };

export function isCodOrder(node: CodOrderNode) {
  return (node.paymentGatewayNames ?? []).some((name) => /cash on delivery|\bcod\b/i.test(name));
}

// Every phone number on the order, normalized (91XXXXXXXXXX for Indian numbers).
export function orderPhones(node: CodOrderNode): string[] {
  const verified = (node.customAttributes ?? []).find((attribute) => attribute?.key === "megaska_verified_phone")?.value;
  const phones = [verified, node.shippingAddress?.phone, node.phone, node.customer?.defaultPhoneNumber?.phoneNumber]
    .map((phone) => normalizeWhatsAppPhone(phone))
    .filter((phone): phone is string => Boolean(phone) && (phone as string).length >= 11);
  return [...new Set(phones)];
}

function formatTotal(money: Money) {
  const amount = Number(money?.amount);
  if (!Number.isFinite(amount)) return "";
  const symbol = !money?.currencyCode || money.currencyCode === "INR" ? "₹" : `${money.currencyCode} `;
  return `${symbol}${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// COD orders that still need asking: not cancelled, not shipped, no answer tag
// yet, a few minutes old and not older than 6 hours.
export function selectCodOrders(nodes: CodOrderNode[], now: number): CodOrder[] {
  const out: CodOrder[] = [];
  for (const node of nodes) {
    if (!node?.id || !node.name || node.cancelledAt || !isCodOrder(node)) continue;
    if (node.displayFulfillmentStatus && node.displayFulfillmentStatus !== "UNFULFILLED") continue;
    const tags = (node.tags ?? []).map((tag) => tag.toLowerCase());
    if (Object.values(COD_TAGS).some((tag) => tags.includes(tag))) continue;
    const createdAt = node.createdAt ? new Date(node.createdAt).getTime() : NaN;
    if (!Number.isFinite(createdAt)) continue;
    const age = now - createdAt;
    if (age < COD_SEND_MIN_AGE_MS || age > COD_SEND_MAX_AGE_MS) continue;
    const phone = orderPhones(node)[0];
    if (!phone) continue;
    const firstName = (node.shippingAddress?.firstName || node.customer?.firstName || "").trim().split(/\s+/)[0] || "there";
    out.push({ orderId: node.id, orderName: node.name, phone, firstName, total: formatTotal(node.totalPriceSet?.shopMoney), createdAt });
  }
  return out;
}

export function numericOrderId(gid: string) {
  return gid.match(/(\d+)$/)?.[1] ?? "";
}

export function codButtonPayload(action: "confirm" | "cancel", orderId: string) {
  return `codc:${action}:${numericOrderId(orderId)}`;
}

export function parseCodPayload(payload: string | null | undefined): { action: "confirm" | "cancel"; orderId: string } | null {
  const match = String(payload || "").trim().match(/^codc:(confirm|cancel):(\d{1,20})$/);
  return match ? { action: match[1] as "confirm" | "cancel", orderId: `gid://shopify/Order/${match[2]}` } : null;
}

export function codTemplateComponents(order: CodOrder) {
  return [
    { type: "body", parameters: [order.firstName, order.orderName, order.total || "-"].map((text) => ({ type: "text", text })) },
    { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: codButtonPayload("confirm", order.orderId) }] },
    { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: codButtonPayload("cancel", order.orderId) }] },
  ];
}

export const COD_REPLIES = {
  confirmed: (name: string) => `Thank you! Your order ${name} is confirmed ✅ We'll ship it soon and share tracking details.`,
  cancelRequested: (name: string) => `We've received your request to cancel order ${name}. Our team will confirm the cancellation here shortly.`,
  alreadyCancelled: (name: string) => `Order ${name} is already cancelled. If you need anything else, just reply here.`,
  alreadyShippedCancel: (name: string) => `Order ${name} has already been shipped. Our team will contact you here about your cancellation request.`,
} as const;

// ---------------------------------------------------------------------------
// I/O

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;
type AuditEvent = { entityId: string | null; eventType: string; createdAt: Date; payload: unknown };
type CodDb = {
  shop: { findMany(args: unknown): Promise<Array<{ id: string; shopDomain: string }>>; findUnique(args: unknown): Promise<{ id: string; shopDomain: string } | null> };
  auditEvent: { findMany(args: unknown): Promise<AuditEvent[]>; create(args: unknown): Promise<unknown> };
  merchantWhatsAppAccount: { findFirst(args: unknown): Promise<MerchantWhatsAppAccountRow | null> };
  whatsAppConversation: { findUnique(args: unknown): Promise<{ id: string; contactName: string | null } | null>; update(args: unknown): Promise<unknown> };
};

const ORDERS_QUERY = `query CodConfirmOrders($query: String!, $after: String) {
  orders(first: 50, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
    nodes {
      id name createdAt cancelledAt displayFulfillmentStatus paymentGatewayNames tags phone
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { firstName defaultPhoneNumber { phoneNumber } }
      shippingAddress { firstName phone }
      customAttributes { key value }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
const ORDER_QUERY = `query CodConfirmOrder($id: ID!) {
  order(id: $id) {
    id name cancelledAt displayFulfillmentStatus tags phone
    customer { defaultPhoneNumber { phoneNumber } }
    shippingAddress { phone }
    customAttributes { key value }
  }
}`;
const TAGS_ADD = `mutation CodConfirmTag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;

const defaultGraphql: Graphql = async (query, variables, options) =>
  ((await import("../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options);

async function defaultDb(): Promise<CodDb> {
  return (await import("../db/prisma.ts")).prisma as unknown as CodDb;
}

async function addTag(graphql: Graphql, shopDomain: string, orderId: string, tag: string) {
  const data = await graphql<{ tagsAdd?: { userErrors?: Array<{ message?: string }> } }>(TAGS_ADD, { id: orderId, tags: [tag] }, { shopDomain });
  const errors = data.tagsAdd?.userErrors ?? [];
  if (errors.length) throw new Error(`tagsAdd failed: ${errors.map((error) => error.message).join("; ")}`);
}

function payloadOf(event: AuditEvent) {
  return (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>;
}

type SendTemplate = (input: { sender: WhatsAppSender; shopId: string; toPhone: string; templateName: string; languageCode: string; components: ReturnType<typeof codTemplateComponents> }) => Promise<{ success: boolean; messageId?: string | null }>;

export type CodConfirmationSummary = { shops: number; candidates: number; sent: number; skippedOptOut: number; noResponseTagged: number; failed: number };

export async function runWhatsAppCodConfirmation(
  input: { now?: Date } = {},
  deps: {
    db?: CodDb;
    graphql?: Graphql;
    listAccounts?: () => Promise<MerchantWhatsAppAccountRow[]>;
    senderFor?: (account: MerchantWhatsAppAccountRow) => WhatsAppSender | null | Promise<WhatsAppSender | null>;
    sendTemplate?: SendTemplate;
    isOptedOut?: (phone: string, senderPhoneNumberId: string) => Promise<boolean>;
  } = {},
): Promise<CodConfirmationSummary> {
  const now = input.now ?? new Date();
  const summary: CodConfirmationSummary = { shops: 0, candidates: 0, sent: 0, skippedOptOut: 0, noResponseTagged: 0, failed: 0 };
  const accounts = await (deps.listAccounts ?? (async () => (await import("../whatsapp/sender.ts")).listCodConfirmationAccounts()))();
  if (!accounts.length) return summary;
  const db = deps.db ?? (await defaultDb());
  const graphql = deps.graphql ?? defaultGraphql;
  const resolveSender = deps.senderFor ?? (async (account: MerchantWhatsAppAccountRow) => (await import("../whatsapp/sender.ts")).merchantSender(account));
  const sendTemplate: SendTemplate = deps.sendTemplate ?? (async (send) => (await import("../whatsapp/index.ts")).sendTemplateMessage({ ...send, recoveryType: "COD_CONFIRMATION" }));
  const isOptedOut = deps.isOptedOut ?? (async (phone: string, senderId: string) => (await import("../whatsapp/consent.ts")).isWhatsAppOptedOut(phone, senderId));
  let budget = MAX_SENDS_PER_RUN;

  const shops = await db.shop.findMany({ where: { id: { in: accounts.map((account) => account.shopId) } }, select: { id: true, shopDomain: true } });
  for (const shop of shops) {
    const account = accounts.find((row) => row.shopId === shop.id);
    const sender = account ? await resolveSender(account) : null;
    if (!account || !sender) { summary.failed += 1; continue; }
    summary.shops += 1;

    const events = await db.auditEvent.findMany({
      where: { entityType: COD_ENTITY_TYPE, eventType: { in: [COD_CONFIRMATION_SENT_EVENT, COD_CONFIRMATION_RESPONSE_EVENT] }, createdAt: { gte: new Date(now.getTime() - EVENT_LOOKBACK_MS) }, payload: { path: ["shopId"], equals: shop.id } },
      select: { entityId: true, eventType: true, createdAt: true, payload: true },
    });
    const sentIds = new Set(events.filter((event) => event.eventType === COD_CONFIRMATION_SENT_EVENT).map((event) => event.entityId));
    const answeredIds = new Set(events.filter((event) => event.eventType === COD_CONFIRMATION_RESPONSE_EVENT).map((event) => event.entityId));

    // 1. Ask new COD orders.
    let orders: CodOrder[] = [];
    try {
      const since = new Date(now.getTime() - COD_SEND_MAX_AGE_MS).toISOString();
      const nodes: CodOrderNode[] = [];
      let after: string | null = null;
      for (let page = 0; page < 4; page += 1) {
        const data: { orders?: { nodes?: CodOrderNode[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } } = await graphql(ORDERS_QUERY, { query: `created_at:>='${since}'`, after }, { shopDomain: shop.shopDomain });
        nodes.push(...(data.orders?.nodes ?? []));
        if (!data.orders?.pageInfo?.hasNextPage) break;
        after = data.orders.pageInfo.endCursor ?? null;
      }
      orders = selectCodOrders(nodes, now.getTime()).filter((order) => !sentIds.has(order.orderId));
    } catch (error) {
      console.error("[COD CONFIRMATION] orders_read_failed", { shopId: shop.id, error: error instanceof Error ? error.message : String(error) });
      summary.failed += 1;
    }
    summary.candidates += orders.length;
    for (const order of orders) {
      if (budget <= 0) break;
      if (await isOptedOut(order.phone, sender.phoneNumberId)) { summary.skippedOptOut += 1; continue; }
      budget -= 1;
      try {
        const result = await sendTemplate({ sender, shopId: shop.id, toPhone: order.phone, templateName: sender.templates.codConfirm || "cod_order_confirmation", languageCode: sender.languageCode, components: codTemplateComponents(order) });
        if (!result.success) { summary.failed += 1; continue; }
        await db.auditEvent.create({ data: { actorType: "system", eventType: COD_CONFIRMATION_SENT_EVENT, entityType: COD_ENTITY_TYPE, entityId: order.orderId, payload: { shopId: shop.id, orderName: order.orderName, phone: order.phone, total: order.total, messageId: result.messageId ?? null } } });
        summary.sent += 1;
      } catch (error) {
        console.error("[COD CONFIRMATION] send_failed", { shopId: shop.id, order: order.orderName, error: error instanceof Error ? error.message : String(error) });
        summary.failed += 1;
      }
    }

    // 2. Tag orders that got no answer in 12 hours, once.
    for (const event of events) {
      if (event.eventType !== COD_CONFIRMATION_SENT_EVENT || !event.entityId || answeredIds.has(event.entityId)) continue;
      if (now.getTime() - new Date(event.createdAt).getTime() < COD_NO_RESPONSE_AFTER_MS) continue;
      try {
        await addTag(graphql, shop.shopDomain, event.entityId, COD_TAGS.noResponse);
        await db.auditEvent.create({ data: { actorType: "system", eventType: COD_CONFIRMATION_RESPONSE_EVENT, entityType: COD_ENTITY_TYPE, entityId: event.entityId, payload: { shopId: shop.id, orderName: payloadOf(event).orderName ?? null, response: "no_response" satisfies CodResponse } } });
        answeredIds.add(event.entityId);
        summary.noResponseTagged += 1;
      } catch (error) {
        console.error("[COD CONFIRMATION] no_response_tag_failed", { shopId: shop.id, orderId: event.entityId, error: error instanceof Error ? error.message : String(error) });
        summary.failed += 1;
      }
    }
  }
  return summary;
}

export type CodReplyResult = { handled: boolean; outcome: string };

// A customer tapped Confirm order / Cancel order. Called by the WhatsApp
// webhook after the message is stored in the inbox.
export async function handleCodConfirmationReply(
  input: { businessPhoneNumberId: string; fromPhone: string; payload: string },
  deps: {
    db?: CodDb;
    graphql?: Graphql;
    sendText?: (input: { shopId: string; conversationId: string; text: string }) => Promise<unknown>;
    alert?: (input: { shopId: string; subject: string; text: string }) => Promise<unknown>;
  } = {},
): Promise<CodReplyResult> {
  const parsed = parseCodPayload(input.payload);
  if (!parsed) return { handled: false, outcome: "not_cod_payload" };
  const db = deps.db ?? (await defaultDb());
  const graphql = deps.graphql ?? defaultGraphql;
  const sendText = deps.sendText ?? (async (send) => (await import("../whatsapp/inbox.ts")).sendConversationText(send));
  const alert = deps.alert ?? (async (message) => (await import("../notifications/email.ts")).sendOpsAlert({ shopId: message.shopId, eventType: "GENERAL", subject: message.subject, text: message.text }));

  const account = await db.merchantWhatsAppAccount.findFirst({ where: { phoneNumberId: input.businessPhoneNumberId } });
  if (!account) return { handled: true, outcome: "unknown_number" };
  const shop = await db.shop.findUnique({ where: { id: account.shopId }, select: { id: true, shopDomain: true } });
  if (!shop) return { handled: true, outcome: "unknown_shop" };
  const fromPhone = normalizeWhatsAppPhone(input.fromPhone);
  const conversation = fromPhone
    ? await db.whatsAppConversation.findUnique({ where: { businessPhoneNumberId_contactPhone: { businessPhoneNumberId: input.businessPhoneNumberId, contactPhone: fromPhone } } })
    : null;

  const data = await graphql<{ order?: CodOrderNode | null }>(ORDER_QUERY, { id: parsed.orderId }, { shopDomain: shop.shopDomain });
  const order = data.order;
  if (!order?.id || !fromPhone || !orderPhones(order).includes(fromPhone)) {
    console.warn("[COD CONFIRMATION] reply_phone_mismatch", { shopId: shop.id, orderId: parsed.orderId });
    return { handled: true, outcome: "phone_mismatch" };
  }
  const name = order.name || "your order";
  const reply = async (text: string) => {
    if (!conversation) return;
    await sendText({ shopId: shop.id, conversationId: conversation.id, text }).catch((error) =>
      console.error("[COD CONFIRMATION] reply_send_failed", { orderId: order.id, error: error instanceof Error ? error.message : String(error) }));
  };
  const previous = await db.auditEvent.findMany({ where: { entityType: COD_ENTITY_TYPE, entityId: order.id, eventType: COD_CONFIRMATION_RESPONSE_EVENT }, select: { entityId: true, eventType: true, createdAt: true, payload: true } });
  const record = (response: CodResponse) => db.auditEvent.create({ data: { actorType: "customer", eventType: COD_CONFIRMATION_RESPONSE_EVENT, entityType: COD_ENTITY_TYPE, entityId: order.id, payload: { shopId: shop.id, orderName: order.name ?? null, response, phone: fromPhone } } });

  if (order.cancelledAt) {
    await reply(COD_REPLIES.alreadyCancelled(name));
    return { handled: true, outcome: "already_cancelled" };
  }

  if (parsed.action === "confirm") {
    if (previous.some((event) => payloadOf(event).response === "confirmed")) return { handled: true, outcome: "already_confirmed" };
    await addTag(graphql, shop.shopDomain, order.id, COD_TAGS.confirmed);
    await record("confirmed");
    await reply(COD_REPLIES.confirmed(name));
    return { handled: true, outcome: "confirmed" };
  }

  if (previous.some((event) => payloadOf(event).response === "cancel_requested")) return { handled: true, outcome: "already_cancel_requested" };
  await addTag(graphql, shop.shopDomain, order.id, COD_TAGS.cancelRequested);
  await record("cancel_requested");
  const shipped = Boolean(order.displayFulfillmentStatus && order.displayFulfillmentStatus !== "UNFULFILLED");
  await reply(shipped ? COD_REPLIES.alreadyShippedCancel(name) : COD_REPLIES.cancelRequested(name));
  if (conversation) {
    await db.whatsAppConversation.update({ where: { id: conversation.id }, data: { needsHuman: true, handoffReason: `COD order ${name}: customer asked to cancel` } }).catch(() => undefined);
  }
  const who = conversation?.contactName || `+${fromPhone}`;
  await alert({
    shopId: shop.id,
    subject: `Cancel request for COD order ${name}`,
    text: [`${who} asked on WhatsApp to cancel COD order ${name}${shipped ? " (already shipped)" : ""}.`, "", "The order is tagged cod-cancel-requested in Shopify. Cancel it there before it ships, and reply to the customer from the WhatsApp inbox."].join("\n"),
  }).catch(() => undefined);
  return { handled: true, outcome: "cancel_requested" };
}
