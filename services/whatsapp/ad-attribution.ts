// Click-to-WhatsApp ads: which ad brought a buyer, and telling Meta about the sale.
//
// Every chat remembers the latest ad that brought the customer (the webhook's
// `referral`: ad id, headline, ctwa_clid; see inbox.ts). When a Shopify order is
// created (orders/create webhook) from a phone that came from an ad in the 7
// days before, the order is attributed to that ad (AuditEvent WHATSAPP_AD_ORDER,
// shown under WhatsApp → Ads) and, with "Report WhatsApp ad sales to Meta" on,
// sent to Meta as a Purchase through the Conversions API for Business Messaging
// (action_source business_messaging, the click's ctwa_clid), so Meta can
// optimise those ads for buyers rather than chats.

import type { MerchantWhatsAppAccountRow } from "./sender.ts";

export const AD_ORDER_EVENT = "WHATSAPP_AD_ORDER";
export const AD_ATTRIBUTION_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

export type AdConversation = { id: string; contactPhone: string; adSourceId: string | null; adHeadline: string | null; adCtwaClid: string | null; adReferredAt: Date | null };

// The most recent ad click before the order, within the attribution window.
export function attributeOrderToAd(conversations: AdConversation[], orderAt: Date): AdConversation | null {
  const from = orderAt.getTime() - AD_ATTRIBUTION_DAYS * DAY;
  return conversations
    .filter((conversation) => conversation.adReferredAt && conversation.adReferredAt.getTime() >= from && conversation.adReferredAt.getTime() <= orderAt.getTime() + 60_000)
    .sort((a, b) => (b.adReferredAt as Date).getTime() - (a.adReferredAt as Date).getTime())[0] ?? null;
}

export function purchaseEventPayload(input: { ctwaClid: string; wabaId: string; orderId: string; value: number; currency: string; eventTime: Date }) {
  return {
    data: [{
      event_name: "Purchase",
      event_time: Math.floor(input.eventTime.getTime() / 1000),
      event_id: input.orderId,
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: { whatsapp_business_account_id: input.wabaId, ctwa_clid: input.ctwaClid },
      custom_data: { currency: input.currency || "INR", value: Math.round(input.value * 100) / 100 },
    }],
  };
}

const graphBase = () => `https://graph.facebook.com/${String(process.env.WHATSAPP_META_GRAPH_VERSION || "v20.0").trim()}`;

type Fetcher = typeof fetch;

// The WhatsApp Business Account's Meta dataset (GET returns it; POST creates it once).
export async function resolveDatasetId(input: { wabaId: string; accessToken: string }, fetcher: Fetcher = fetch): Promise<string> {
  const url = `${graphBase()}/${encodeURIComponent(input.wabaId)}/dataset`;
  const headers = { Authorization: `Bearer ${input.accessToken}` };
  const idFrom = (data: unknown) => {
    const value = data as { id?: string; data?: Array<{ id?: string }> } | null;
    return value?.id || value?.data?.[0]?.id || null;
  };
  const existing = await fetcher(url, { headers, cache: "no-store" });
  const existingData = await existing.json().catch(() => null);
  if (existing.ok && idFrom(existingData)) return String(idFrom(existingData));
  const created = await fetcher(url, { method: "POST", headers });
  const createdData = (await created.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!created.ok || !idFrom(createdData)) throw new Error(`Meta dataset lookup failed: ${createdData?.error?.message || (existingData as { error?: { message?: string } } | null)?.error?.message || `HTTP ${created.status}`}`);
  return String(idFrom(createdData));
}

type AttributionDb = {
  shop: { findFirst(args: unknown): Promise<{ id: string } | null> };
  merchantWhatsAppAccount: { findUnique(args: unknown): Promise<MerchantWhatsAppAccountRow & { adConversionsEnabled?: boolean; capiDatasetId?: string | null } | null>; update(args: unknown): Promise<unknown> };
  whatsAppConversation: { findMany(args: unknown): Promise<AdConversation[]> };
  auditEvent: { findFirst(args: unknown): Promise<{ id: string } | null>; create(args: unknown): Promise<unknown> };
};

export type AdOrderResult = { outcome: "not_from_ad" | "already_recorded" | "recorded" | "reported" | "report_failed" | "no_shop"; adSourceId?: string | null; error?: string };

export async function recordWhatsAppAdOrder(
  input: { shopDomain: string; order: { id: string; name: string; createdAt: Date; total: number; currency: string; phones: string[] } },
  deps: { db?: AttributionDb; fetcher?: Fetcher; decrypt?: (value: string) => string | null } = {},
): Promise<AdOrderResult> {
  const db = deps.db ?? ((await import("../db/prisma.ts")).prisma as unknown as AttributionDb);
  const shop = await db.shop.findFirst({ where: { shopDomain: input.shopDomain }, select: { id: true } });
  if (!shop) return { outcome: "no_shop" };
  const { normalizeWhatsAppPhone } = await import("./consent.ts");
  const phones = [...new Set(input.order.phones.map((phone) => normalizeWhatsAppPhone(phone)).filter((phone): phone is string => Boolean(phone) && (phone as string).length >= 11))];
  if (!phones.length) return { outcome: "not_from_ad" };
  const conversations = await db.whatsAppConversation.findMany({
    where: { shopId: shop.id, contactPhone: { in: phones }, adReferredAt: { gte: new Date(input.order.createdAt.getTime() - AD_ATTRIBUTION_DAYS * DAY) } },
    select: { id: true, contactPhone: true, adSourceId: true, adHeadline: true, adCtwaClid: true, adReferredAt: true },
  });
  const conversation = attributeOrderToAd(conversations, input.order.createdAt);
  if (!conversation) return { outcome: "not_from_ad" };
  if (await db.auditEvent.findFirst({ where: { eventType: AD_ORDER_EVENT, entityType: "ShopifyOrder", entityId: input.order.id }, select: { id: true } })) return { outcome: "already_recorded" };

  // Report to Meta when switched on and the click id is known.
  let capi: { status: "off" | "no_click_id" | "sent" | "failed"; error?: string } = { status: "off" };
  const account = await db.merchantWhatsAppAccount.findUnique({ where: { shopId: shop.id } });
  if (account?.adConversionsEnabled) {
    if (!conversation.adCtwaClid) capi = { status: "no_click_id" };
    else {
      try {
        const { merchantSender } = await import("./sender.ts");
        const sender = merchantSender(account, deps.decrypt);
        if (!sender || !account.businessAccountId) throw new Error("WhatsApp number or Business Account ID missing in settings");
        const fetcher = deps.fetcher ?? fetch;
        let datasetId = account.capiDatasetId || null;
        if (!datasetId) {
          datasetId = await resolveDatasetId({ wabaId: account.businessAccountId, accessToken: sender.accessToken }, fetcher);
          await db.merchantWhatsAppAccount.update({ where: { shopId: shop.id }, data: { capiDatasetId: datasetId } });
        }
        const response = await fetcher(`${graphBase()}/${encodeURIComponent(datasetId)}/events`, {
          method: "POST",
          headers: { Authorization: `Bearer ${sender.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(purchaseEventPayload({ ctwaClid: conversation.adCtwaClid, wabaId: account.businessAccountId, orderId: input.order.id, value: input.order.total, currency: input.order.currency, eventTime: input.order.createdAt })),
        });
        const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        capi = response.ok ? { status: "sent" } : { status: "failed", error: String(data?.error?.message || `HTTP ${response.status}`).slice(0, 300) };
      } catch (error) {
        capi = { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
      }
    }
  }

  await db.auditEvent.create({
    data: {
      actorType: "system",
      eventType: AD_ORDER_EVENT,
      entityType: "ShopifyOrder",
      entityId: input.order.id,
      payload: { shopId: shop.id, orderName: input.order.name, total: input.order.total, currency: input.order.currency, conversationId: conversation.id, adSourceId: conversation.adSourceId, adHeadline: conversation.adHeadline, adReferredAt: conversation.adReferredAt?.toISOString() ?? null, capi: capi.status, capiError: capi.error ?? null },
    },
  });
  if (capi.status === "failed") console.error("[WHATSAPP ADS] capi_failed", { order: input.order.name, error: capi.error });
  return { outcome: capi.status === "sent" ? "reported" : capi.status === "failed" ? "report_failed" : "recorded", adSourceId: conversation.adSourceId, ...(capi.error ? { error: capi.error } : {}) };
}
