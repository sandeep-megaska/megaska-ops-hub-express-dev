// WhatsApp shipping updates from the courier tracking already in Shopify
// (fulfillment events written by the courier integration):
//
//   shipped                  first IN_TRANSIT (parcel picked up), with tracking link
//   out_for_delivery         latest event is OUT_FOR_DELIVERY; tells COD customers the amount to keep ready
//   delivery_attempt_failed  an OUT_FOR_DELIVERY followed by IN_TRANSIT again (not delivered):
//                            the customer can reply to arrange another attempt — the main RTO saver
//   delivered                DELIVERED; invites size questions in the chat
//
// Run from the 15-minute checkout-recovery cron for shops with shipping updates
// on. One message per order per run: the most advanced pending step wins, so a
// fast delivery never gets a stale "shipped" afterwards. Each step (and each
// failed attempt, at most two) is sent once and recorded as an AuditEvent on
// the order. Messages go out between 8 am and 9 pm IST only; events older than
// 24 hours (12 for out for delivery) are not announced late.

import type { MerchantWhatsAppAccountRow, WhatsAppSender } from "../whatsapp/sender.ts";
import { isCodOrder, orderPhones, type CodOrderNode } from "./whatsapp-cod-confirmation.ts";

export const SHIPPING_UPDATE_SENT_EVENT = "WHATSAPP_SHIPPING_UPDATE_SENT";
const ENTITY_TYPE = "ShopifyOrder";
const HOUR = 60 * 60 * 1000;
export const ANNOUNCE_WINDOW_MS = 24 * HOUR;
export const OUT_FOR_DELIVERY_WINDOW_MS = 12 * HOUR;
export const MAX_FAILED_ATTEMPT_MESSAGES = 2;
const ORDER_LOOKBACK_MS = 2 * 24 * HOUR;
const EVENT_LOOKBACK_MS = 21 * 24 * HOUR;
const MAX_SENDS_PER_RUN = 60;

export type ShippingStep = "shipped" | "out_for_delivery" | "delivery_attempt_failed" | "delivered";

export const SHIPPING_TEMPLATES: Record<ShippingStep, string> = {
  shipped: "order_shipped",
  out_for_delivery: "order_out_for_delivery",
  delivery_attempt_failed: "order_delivery_attempt_failed",
  delivered: "order_delivered",
};

type Money = { amount?: string | null; currencyCode?: string | null } | null | undefined;
export type ShippingOrderNode = CodOrderNode & {
  displayFinancialStatus?: string | null;
  totalOutstandingSet?: { shopMoney?: Money } | null;
  fulfillments?: Array<{
    id?: string | null;
    createdAt?: string | null;
    status?: string | null;
    deliveredAt?: string | null;
    trackingInfo?: Array<{ company?: string | null; number?: string | null; url?: string | null }> | null;
    events?: { nodes?: Array<{ status?: string | null; happenedAt?: string | null }> | null } | null;
  }> | null;
};

export type SentUpdate = { step: ShippingStep; key: string };
export type DueUpdate = { step: ShippingStep; key: string; variables: string[] };

// 8 am – 9 pm in India.
export function withinSendingHours(now: Date) {
  const minutesIst = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  return minutesIst >= 8 * 60 && minutesIst < 21 * 60;
}

function rupees(money: Money) {
  const amount = Number(money?.amount);
  if (!Number.isFinite(amount)) return null;
  const symbol = !money?.currencyCode || money.currencyCode === "INR" ? "₹" : `${money.currencyCode} `;
  return `${symbol}${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : NaN);

// The one update this order is due now, if any.
export function dueShippingUpdate(order: ShippingOrderNode, sent: SentUpdate[], now: number): DueUpdate | null {
  if (!order?.id || !order.name || order.cancelledAt) return null;
  const fulfillment = (order.fulfillments ?? []).find((entry) => entry?.status === "SUCCESS" && (entry.trackingInfo ?? []).length) ?? null;
  if (!fulfillment) return null;
  const firstName = (order.shippingAddress?.firstName || order.customer?.firstName || "").trim().split(/\s+/)[0] || "there";
  const events = (fulfillment.events?.nodes ?? [])
    .map((event) => ({ status: String(event?.status || ""), at: time(event?.happenedAt) }))
    .filter((event) => Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at);
  const wasSent = (step: ShippingStep, key: string) => sent.some((entry) => entry.step === step && entry.key === key);
  const recent = (at: number, window = ANNOUNCE_WINDOW_MS) => Number.isFinite(at) && now - at <= window && at <= now;

  // Delivered: final; nothing else is announced after it.
  const deliveredAt = Number.isFinite(time(fulfillment.deliveredAt)) ? time(fulfillment.deliveredAt) : events.find((event) => event.status === "DELIVERED")?.at ?? NaN;
  if (Number.isFinite(deliveredAt)) {
    return recent(deliveredAt) && !wasSent("delivered", "delivered") ? { step: "delivered", key: "delivered", variables: [firstName, order.name] } : null;
  }

  // Failed attempts: OUT_FOR_DELIVERY followed by IN_TRANSIT again.
  const failed: Array<{ key: string; returnedAt: number }> = [];
  events.forEach((event, index) => {
    if (event.status !== "OUT_FOR_DELIVERY") return;
    const back = events.slice(index + 1).find((next) => next.status === "IN_TRANSIT" || next.status === "ATTEMPTED_DELIVERY");
    const nextOfd = events.slice(index + 1).find((next) => next.status === "OUT_FOR_DELIVERY");
    if (back && (!nextOfd || back.at <= nextOfd.at)) failed.push({ key: new Date(event.at).toISOString(), returnedAt: back.at });
  });
  const last = events[events.length - 1];
  const failedSent = sent.filter((entry) => entry.step === "delivery_attempt_failed").length;
  const latestFailed = failed[failed.length - 1];
  if (latestFailed && last && last.status !== "OUT_FOR_DELIVERY" && recent(latestFailed.returnedAt) && failedSent < MAX_FAILED_ATTEMPT_MESSAGES && !wasSent("delivery_attempt_failed", latestFailed.key)) {
    return { step: "delivery_attempt_failed", key: latestFailed.key, variables: [firstName, order.name] };
  }

  // Out for delivery (each attempt day once).
  if (last?.status === "OUT_FOR_DELIVERY") {
    const key = new Date(last.at).toISOString();
    if (!recent(last.at, OUT_FOR_DELIVERY_WINDOW_MS) || wasSent("out_for_delivery", key)) return null;
    const due = isCodOrder(order) ? rupees(order.totalOutstandingSet?.shopMoney) : null;
    const amount = due && Number(order.totalOutstandingSet?.shopMoney?.amount) > 0 ? `${due} (Cash on Delivery)` : "nothing, it's already paid";
    return { step: "out_for_delivery", key, variables: [firstName, order.name, amount] };
  }

  // Shipped: picked up by the courier (or, without courier events, fulfilled with tracking).
  if (events.some((event) => event.status === "OUT_FOR_DELIVERY")) return null;
  const pickedUpAt = events.find((event) => event.status === "IN_TRANSIT")?.at ?? (events.length ? NaN : time(fulfillment.createdAt));
  if (!recent(pickedUpAt) || wasSent("shipped", "shipped")) return null;
  const tracking = (fulfillment.trackingInfo ?? [])[0];
  return { step: "shipped", key: "shipped", variables: [firstName, order.name, tracking?.company || "our courier partner", tracking?.url || tracking?.number || "-"] };
}

// ---------------------------------------------------------------------------
// I/O

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;
type AuditEvent = { entityId: string | null; createdAt: Date; payload: unknown };
type ShippingDb = {
  shop: { findMany(args: unknown): Promise<Array<{ id: string; shopDomain: string }>> };
  auditEvent: { findMany(args: unknown): Promise<AuditEvent[]>; create(args: unknown): Promise<unknown> };
};

const ORDERS_QUERY = `query ShippingUpdateOrders($query: String!, $after: String) {
  orders(first: 50, after: $after, sortKey: UPDATED_AT, reverse: true, query: $query) {
    nodes {
      id name cancelledAt paymentGatewayNames displayFinancialStatus phone
      totalOutstandingSet { shopMoney { amount currencyCode } }
      customer { firstName defaultPhoneNumber { phoneNumber } }
      shippingAddress { firstName phone }
      customAttributes { key value }
      fulfillments(first: 3) {
        id createdAt status deliveredAt
        trackingInfo(first: 1) { company number url }
        events(first: 20) { nodes { status happenedAt } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

type SendTemplate = (input: { sender: WhatsAppSender; shopId: string; toPhone: string; templateName: string; languageCode: string; variables: string[] }) => Promise<{ success: boolean; messageId?: string | null }>;

export type ShippingUpdatesSummary = { shops: number; checked: number; sent: Record<ShippingStep, number>; skippedOptOut: number; skippedQuietHours: boolean; failed: number };

export async function runWhatsAppShippingUpdates(
  input: { now?: Date } = {},
  deps: {
    db?: ShippingDb;
    graphql?: Graphql;
    listAccounts?: () => Promise<MerchantWhatsAppAccountRow[]>;
    senderFor?: (account: MerchantWhatsAppAccountRow) => WhatsAppSender | null | Promise<WhatsAppSender | null>;
    sendTemplate?: SendTemplate;
    isOptedOut?: (phone: string, senderPhoneNumberId: string) => Promise<boolean>;
  } = {},
): Promise<ShippingUpdatesSummary> {
  const now = input.now ?? new Date();
  const summary: ShippingUpdatesSummary = { shops: 0, checked: 0, sent: { shipped: 0, out_for_delivery: 0, delivery_attempt_failed: 0, delivered: 0 }, skippedOptOut: 0, skippedQuietHours: false, failed: 0 };
  if (!withinSendingHours(now)) { summary.skippedQuietHours = true; return summary; }
  const accounts = await (deps.listAccounts ?? (async () => (await import("../whatsapp/sender.ts")).listShippingUpdateAccounts()))();
  if (!accounts.length) return summary;
  const db = deps.db ?? ((await import("../db/prisma.ts")).prisma as unknown as ShippingDb);
  const graphql = deps.graphql ?? (async (query, variables, options) => ((await import("../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options));
  const resolveSender = deps.senderFor ?? (async (account: MerchantWhatsAppAccountRow) => (await import("../whatsapp/sender.ts")).merchantSender(account));
  const sendTemplate: SendTemplate = deps.sendTemplate ?? (async (send) => (await import("../whatsapp/index.ts")).sendTemplateMessage({ ...send, recoveryType: "SHIPPING_UPDATE" }));
  const isOptedOut = deps.isOptedOut ?? (async (phone: string, senderId: string) => (await import("../whatsapp/consent.ts")).isWhatsAppOptedOut(phone, senderId));
  let budget = MAX_SENDS_PER_RUN;

  const shops = await db.shop.findMany({ where: { id: { in: accounts.map((account) => account.shopId) } }, select: { id: true, shopDomain: true } });
  for (const shop of shops) {
    const account = accounts.find((row) => row.shopId === shop.id);
    const sender = account ? await resolveSender(account) : null;
    if (!sender) { summary.failed += 1; continue; }
    summary.shops += 1;

    let orders: ShippingOrderNode[] = [];
    try {
      const since = new Date(now.getTime() - ORDER_LOOKBACK_MS).toISOString();
      let after: string | null = null;
      for (let page = 0; page < 4; page += 1) {
        const data: { orders?: { nodes?: ShippingOrderNode[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } } = await graphql(ORDERS_QUERY, { query: `fulfillment_status:shipped AND updated_at:>='${since}'`, after }, { shopDomain: shop.shopDomain });
        orders.push(...(data.orders?.nodes ?? []));
        if (!data.orders?.pageInfo?.hasNextPage) break;
        after = data.orders.pageInfo.endCursor ?? null;
      }
    } catch (error) {
      console.error("[SHIPPING UPDATES] orders_read_failed", { shopId: shop.id, error: error instanceof Error ? error.message : String(error) });
      summary.failed += 1;
      orders = [];
    }
    if (!orders.length) continue;
    summary.checked += orders.length;

    const events = await db.auditEvent.findMany({
      where: { entityType: ENTITY_TYPE, eventType: SHIPPING_UPDATE_SENT_EVENT, createdAt: { gte: new Date(now.getTime() - EVENT_LOOKBACK_MS) }, payload: { path: ["shopId"], equals: shop.id } },
      select: { entityId: true, createdAt: true, payload: true },
    });
    const sentFor = (orderId: string): SentUpdate[] => events
      .filter((event) => event.entityId === orderId)
      .map((event) => event.payload as { step?: ShippingStep; key?: string })
      .filter((payload): payload is SentUpdate => Boolean(payload?.step && payload.key));

    for (const order of orders) {
      if (budget <= 0) break;
      const due = dueShippingUpdate(order, sentFor(String(order.id)), now.getTime());
      if (!due) continue;
      const phone = orderPhones(order)[0];
      if (!phone) continue;
      if (await isOptedOut(phone, sender.phoneNumberId)) { summary.skippedOptOut += 1; continue; }
      budget -= 1;
      try {
        const result = await sendTemplate({ sender, shopId: shop.id, toPhone: phone, templateName: SHIPPING_TEMPLATES[due.step], languageCode: sender.languageCode, variables: due.variables });
        if (!result.success) { summary.failed += 1; continue; }
        await db.auditEvent.create({ data: { actorType: "system", eventType: SHIPPING_UPDATE_SENT_EVENT, entityType: ENTITY_TYPE, entityId: order.id, payload: { shopId: shop.id, orderName: order.name, step: due.step, key: due.key, phone, messageId: result.messageId ?? null } } });
        summary.sent[due.step] += 1;
      } catch (error) {
        console.error("[SHIPPING UPDATES] send_failed", { shopId: shop.id, order: order.name, step: due.step, error: error instanceof Error ? error.message : String(error) });
        summary.failed += 1;
      }
    }
  }
  return summary;
}
