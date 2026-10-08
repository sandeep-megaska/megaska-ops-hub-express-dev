// Second-order nudge on WhatsApp.
//
// One message to a first-time customer some days after their first order was
// delivered (default 21: long enough to have worn it), inviting them back with
// the merchant's own, current offer line. Never sent when:
//   - they have ordered again (Shopify customer has more than one order),
//   - the order was cancelled, refunded (fully or partly) or has a return,
//   - their WhatsApp chat is waiting on the team (an open complaint or issue),
//   - they replied STOP,
// and only once per customer (AuditEvent WHATSAPP_SECOND_ORDER_NUDGE_SENT).
// Runs from the 15-minute cron, 11 am – 7 pm IST.

import type { MerchantWhatsAppAccountRow, WhatsAppSender } from "../whatsapp/sender.ts";
import { orderPhones, type CodOrderNode } from "./whatsapp-cod-confirmation.ts";

export const SECOND_ORDER_TEMPLATE = "second_order_nudge";
export const SECOND_ORDER_SENT_EVENT = "WHATSAPP_SECOND_ORDER_NUDGE_SENT";
const ENTITY_TYPE = "ShopifyCustomer";
const DAY = 24 * 60 * 60 * 1000;
// Orders delivered up to this many days after the nudge day still qualify (cron or Shopify hiccups).
const CATCH_UP_DAYS = 7;
const MAX_SENDS_PER_RUN = 40;

export type SecondOrderNode = CodOrderNode & {
  displayFinancialStatus?: string | null;
  returnStatus?: string | null;
  customer?: (CodOrderNode["customer"] & { id?: string | null; numberOfOrders?: string | number | null }) | null;
  lineItems?: { nodes?: Array<{ title?: string | null }> | null } | null;
  fulfillments?: Array<{ status?: string | null; deliveredAt?: string | null; events?: { nodes?: Array<{ status?: string | null; happenedAt?: string | null }> | null } | null }> | null;
};

export type NudgeCandidate = { customerId: string; orderName: string; phone: string; firstName: string; product: string; deliveredAt: number };

// 11 am – 7 pm in India.
export function withinNudgeHours(now: Date) {
  const minutesIst = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  return minutesIst >= 11 * 60 && minutesIst < 19 * 60;
}

function deliveredAtOf(order: SecondOrderNode) {
  let latest = NaN;
  for (const fulfillment of order.fulfillments ?? []) {
    const at = fulfillment?.deliveredAt ? Date.parse(fulfillment.deliveredAt)
      : Date.parse((fulfillment?.events?.nodes ?? []).find((event) => event?.status === "DELIVERED")?.happenedAt || "");
    if (Number.isFinite(at) && !(latest >= at)) latest = at;
  }
  return latest;
}

// The first-order customers due a nudge today.
export function selectSecondOrderCandidates(orders: SecondOrderNode[], input: { now: number; delayDays: number; alreadyNudged: Set<string> }): NudgeCandidate[] {
  const out: NudgeCandidate[] = [];
  const seen = new Set<string>();
  for (const order of orders) {
    const customerId = order?.customer?.id;
    if (!customerId || !order.name || seen.has(customerId) || input.alreadyNudged.has(customerId)) continue;
    if (Number(order.customer?.numberOfOrders ?? 0) !== 1) continue;
    if (order.cancelledAt) continue;
    if (/REFUND|VOID/i.test(order.displayFinancialStatus || "")) continue;
    if (order.returnStatus && order.returnStatus !== "NO_RETURN") continue;
    const deliveredAt = deliveredAtOf(order);
    if (!Number.isFinite(deliveredAt)) continue;
    const age = input.now - deliveredAt;
    if (age < input.delayDays * DAY || age > (input.delayDays + CATCH_UP_DAYS) * DAY) continue;
    const phone = orderPhones(order)[0];
    if (!phone) continue;
    seen.add(customerId);
    const firstName = (order.shippingAddress?.firstName || order.customer?.firstName || "").trim().split(/\s+/)[0] || "there";
    const product = (order.lineItems?.nodes ?? []).map((line) => line?.title || "").find(Boolean) || "order";
    out.push({ customerId, orderName: order.name, phone, firstName, product: product.slice(0, 120), deliveredAt });
  }
  return out;
}

export function storeLink(storeUrl: string) {
  try {
    const url = new URL(storeUrl);
    url.searchParams.set("utm_source", "whatsapp");
    url.searchParams.set("utm_medium", "second_order");
    return url.toString();
  } catch {
    return storeUrl;
  }
}

// ---------------------------------------------------------------------------
// I/O

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;
type SendTemplate = (input: { sender: WhatsAppSender; shopId: string; toPhone: string; templateName: string; languageCode: string; variables: string[] }) => Promise<{ success: boolean; messageId?: string | null }>;
type NudgeDb = {
  shop: { findMany(args: unknown): Promise<Array<{ id: string; shopDomain: string; primaryDomain: string | null }>> };
  auditEvent: { findMany(args: unknown): Promise<Array<{ entityId: string | null }>>; create(args: unknown): Promise<unknown> };
  whatsAppConversation: { findFirst(args: unknown): Promise<{ id: string } | null> };
};

const ORDERS_QUERY = `query SecondOrderCandidates($query: String!, $after: String) {
  orders(first: 50, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
    nodes {
      id name cancelledAt displayFinancialStatus returnStatus phone
      customer { id firstName numberOfOrders defaultPhoneNumber { phoneNumber } }
      shippingAddress { firstName phone }
      customAttributes { key value }
      lineItems(first: 1) { nodes { title } }
      fulfillments(first: 3) { status deliveredAt events(first: 20) { nodes { status happenedAt } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export type SecondOrderSummary = { shops: number; checked: number; sent: number; skippedOptOut: number; skippedOpenChat: number; skippedQuietHours: boolean; failed: number };

export async function runWhatsAppSecondOrderNudges(
  input: { now?: Date } = {},
  deps: {
    db?: NudgeDb;
    graphql?: Graphql;
    listAccounts?: () => Promise<MerchantWhatsAppAccountRow[]>;
    senderFor?: (account: MerchantWhatsAppAccountRow) => WhatsAppSender | null | Promise<WhatsAppSender | null>;
    sendTemplate?: SendTemplate;
    isOptedOut?: (phone: string, senderPhoneNumberId: string) => Promise<boolean>;
  } = {},
): Promise<SecondOrderSummary> {
  const now = input.now ?? new Date();
  const summary: SecondOrderSummary = { shops: 0, checked: 0, sent: 0, skippedOptOut: 0, skippedOpenChat: 0, skippedQuietHours: false, failed: 0 };
  if (!withinNudgeHours(now)) { summary.skippedQuietHours = true; return summary; }
  const accounts = (await (deps.listAccounts ?? (async () => (await import("../whatsapp/sender.ts")).listWhatsAppAccountsWith("secondOrderEnabled")))())
    .filter((account) => (account.secondOrderOffer || "").trim());
  if (!accounts.length) return summary;
  const db = deps.db ?? ((await import("../db/prisma.ts")).prisma as unknown as NudgeDb);
  const graphql = deps.graphql ?? (async (query, variables, options) => ((await import("../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options));
  const resolveSender = deps.senderFor ?? (async (account: MerchantWhatsAppAccountRow) => (await import("../whatsapp/sender.ts")).merchantSender(account));
  const sendTemplate: SendTemplate = deps.sendTemplate ?? (async (send) => (await import("../whatsapp/index.ts")).sendTemplateMessage({ ...send, recoveryType: "SECOND_ORDER" }));
  const isOptedOut = deps.isOptedOut ?? (async (phone: string, senderId: string) => (await import("../whatsapp/consent.ts")).isWhatsAppOptedOut(phone, senderId));
  let budget = MAX_SENDS_PER_RUN;

  const shops = await db.shop.findMany({ where: { id: { in: accounts.map((account) => account.shopId) } }, select: { id: true, shopDomain: true, primaryDomain: true } });
  for (const shop of shops) {
    const account = accounts.find((row) => row.shopId === shop.id);
    const sender = account ? await resolveSender(account) : null;
    if (!account || !sender) { summary.failed += 1; continue; }
    summary.shops += 1;
    const delayDays = account.secondOrderDelayDays ?? 21;

    // Orders placed in the window that can have been delivered delayDays … delayDays+7 days ago.
    let orders: SecondOrderNode[] = [];
    try {
      const from = new Date(now.getTime() - (delayDays + CATCH_UP_DAYS + 20) * DAY).toISOString();
      const to = new Date(now.getTime() - delayDays * DAY).toISOString();
      let after: string | null = null;
      for (let page = 0; page < 6; page += 1) {
        const data: { orders?: { nodes?: SecondOrderNode[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } } = await graphql(ORDERS_QUERY, { query: `fulfillment_status:shipped AND created_at:>='${from}' AND created_at:<='${to}'`, after }, { shopDomain: shop.shopDomain });
        orders.push(...(data.orders?.nodes ?? []));
        if (!data.orders?.pageInfo?.hasNextPage) break;
        after = data.orders.pageInfo.endCursor ?? null;
      }
    } catch (error) {
      console.error("[SECOND ORDER] orders_read_failed", { shopId: shop.id, error: error instanceof Error ? error.message : String(error) });
      summary.failed += 1;
      orders = [];
    }
    if (!orders.length) continue;
    summary.checked += orders.length;

    const customerIds = [...new Set(orders.map((order) => order.customer?.id).filter((id): id is string => Boolean(id)))];
    const nudged = await db.auditEvent.findMany({ where: { entityType: ENTITY_TYPE, eventType: SECOND_ORDER_SENT_EVENT, entityId: { in: customerIds }, payload: { path: ["shopId"], equals: shop.id } }, select: { entityId: true } });
    const candidates = selectSecondOrderCandidates(orders, { now: now.getTime(), delayDays, alreadyNudged: new Set(nudged.map((event) => String(event.entityId))) });
    const storeUrl = storeLink(shop.primaryDomain ? `https://${shop.primaryDomain.replace(/^https?:\/\//, "")}` : `https://${shop.shopDomain}`);

    for (const candidate of candidates) {
      if (budget <= 0) break;
      if (await isOptedOut(candidate.phone, sender.phoneNumberId)) { summary.skippedOptOut += 1; continue; }
      const openChat = await db.whatsAppConversation.findFirst({ where: { shopId: shop.id, contactPhone: candidate.phone, needsHuman: true }, select: { id: true } });
      if (openChat) { summary.skippedOpenChat += 1; continue; }
      budget -= 1;
      try {
        const result = await sendTemplate({ sender, shopId: shop.id, toPhone: candidate.phone, templateName: SECOND_ORDER_TEMPLATE, languageCode: sender.languageCode, variables: [candidate.firstName, candidate.product, storeUrl, String(account.secondOrderOffer).trim()] });
        if (!result.success) { summary.failed += 1; continue; }
        await db.auditEvent.create({ data: { actorType: "system", eventType: SECOND_ORDER_SENT_EVENT, entityType: ENTITY_TYPE, entityId: candidate.customerId, payload: { shopId: shop.id, orderName: candidate.orderName, phone: candidate.phone, messageId: result.messageId ?? null } } });
        summary.sent += 1;
      } catch (error) {
        console.error("[SECOND ORDER] send_failed", { shopId: shop.id, order: candidate.orderName, error: error instanceof Error ? error.message : String(error) });
        summary.failed += 1;
      }
    }
  }
  return summary;
}
