/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { adContextFor } from "./assistant/run.ts";
import { buildUserPrompt } from "./assistant/policy.ts";
import { adReferralFields } from "./inbox.ts";
import { AD_ORDER_EVENT, attributeOrderToAd, purchaseEventPayload, recordWhatsAppAdOrder, resolveDatasetId } from "./ad-attribution.ts";

const DAY = 24 * 60 * 60 * 1000;
const ORDER_AT = new Date("2026-10-10T10:00:00Z");

test("the ad behind a chat is read from the webhook referral; other referrals are ignored", () => {
  const at = new Date("2026-10-09T05:00:00Z");
  assert.deepEqual(adReferralFields({ referral: { source_type: "ad", source_id: "120200001", headline: "Modest swimwear", body: "Full coverage, COD", ctwa_clid: "ARAkLkA8rmlFeiCktEJQ" } } as any, at), { adSourceId: "120200001", adHeadline: "Modest swimwear", adBody: "Full coverage, COD", adCtwaClid: "ARAkLkA8rmlFeiCktEJQ", adReferredAt: at });
  assert.equal(adReferralFields({ referral: { source_type: "post", source_id: "1" } } as any, at), null);
  assert.equal(adReferralFields({ type: "text" } as any, at), null);
  assert.equal(adReferralFields({ referral: { source_type: "ad", headline: "x" } } as any, at), null, "nothing to attribute without ad id or click id");
});

test("orders are attributed to the latest ad click in the 7 days before", () => {
  const chat = (id: string, daysBefore: number | null) => ({ id, contactPhone: "919876543210", adSourceId: id, adHeadline: null, adCtwaClid: `clid-${id}`, adReferredAt: daysBefore === null ? null : new Date(ORDER_AT.getTime() - daysBefore * DAY) });
  assert.equal(attributeOrderToAd([chat("old", 9), chat("recent", 2), chat("older", 5)], ORDER_AT)?.id, "recent");
  assert.equal(attributeOrderToAd([chat("old", 9), chat("none", null)], ORDER_AT), null);
});

test("the Purchase event carries the click id and WABA for Business Messaging", () => {
  assert.deepEqual(purchaseEventPayload({ ctwaClid: "clid", wabaId: "1619844212877837", orderId: "gid://shopify/Order/9", value: 1195.5, currency: "INR", eventTime: ORDER_AT }), { data: [{
    event_name: "Purchase", event_time: Math.floor(ORDER_AT.getTime() / 1000), event_id: "gid://shopify/Order/9", action_source: "business_messaging", messaging_channel: "whatsapp",
    user_data: { whatsapp_business_account_id: "1619844212877837", ctwa_clid: "clid" }, custom_data: { currency: "INR", value: 1195.5 },
  }] });
});

test("the WABA dataset is read, or created once", async () => {
  const calls: string[] = [];
  const fetcher = (responses: any[]) => (async (url: string, init?: any) => { calls.push(`${init?.method || "GET"} ${url}`); const next = responses.shift(); return { ok: next.ok, status: next.ok ? 200 : 400, json: async () => next.body } as any; }) as any;
  assert.equal(await resolveDatasetId({ wabaId: "1", accessToken: "t" }, fetcher([{ ok: true, body: { data: [{ id: "ds1" }] } }])), "ds1");
  assert.equal(await resolveDatasetId({ wabaId: "1", accessToken: "t" }, fetcher([{ ok: true, body: { data: [] } }, { ok: true, body: { id: "ds2" } }])), "ds2");
  assert.match(calls.at(-1)!, /^POST .*\/1\/dataset$/);
  await assert.rejects(resolveDatasetId({ wabaId: "1", accessToken: "t" }, fetcher([{ ok: false, body: { error: { message: "no permission" } } }, { ok: false, body: { error: { message: "Missing permission whatsapp_business_manage_events" } } }])), /whatsapp_business_manage_events/);
});

function setup(overrides: any = {}) {
  const audits: any[] = [];
  const updates: any[] = [];
  const posts: any[] = [];
  const db: any = {
    shop: { findFirst: async () => ({ id: "s1" }) },
    merchantWhatsAppAccount: {
      findUnique: async () => ({ shopId: "s1", enabled: true, phoneNumberId: "pn", accessTokenEncrypted: "enc", businessAccountId: "1619844212877837", templateLanguage: "en", adConversionsEnabled: true, capiDatasetId: null, ...overrides.account }),
      update: async (args: any) => { updates.push(args.data); },
    },
    whatsAppConversation: { findMany: async (args: any) => { assert.deepEqual(args.where.contactPhone.in, ["919876543210"]); return overrides.chats ?? [{ id: "c1", contactPhone: "919876543210", adSourceId: "120200001", adHeadline: "Modest swimwear", adCtwaClid: "clid", adReferredAt: new Date(ORDER_AT.getTime() - DAY) }]; } },
    auditEvent: { findFirst: async () => overrides.existing ?? null, create: async (args: any) => { audits.push(args.data); } },
  };
  const fetcher = (async (url: string, init?: any) => {
    if (url.endsWith("/dataset")) return { ok: true, json: async () => ({ data: [{ id: "ds9" }] }) } as any;
    posts.push({ url, body: JSON.parse(init.body) });
    return { ok: overrides.capiOk ?? true, status: 400, json: async () => (overrides.capiOk === false ? { error: { message: "Invalid parameter" } } : { events_received: 1 }) } as any;
  }) as any;
  return { deps: { db, fetcher, decrypt: () => "token" }, audits, updates, posts };
}
const order = { id: "gid://shopify/Order/9", name: "#522500", createdAt: ORDER_AT, total: 1195, currency: "INR", phones: ["+91 98765 43210", "9876543210"] };

test("an order from an ad chat is recorded and reported to Meta once", async () => {
  const { deps, audits, updates, posts } = setup();
  const result = await recordWhatsAppAdOrder({ shopDomain: "shop.myshopify.com", order }, deps);
  assert.equal(result.outcome, "reported");
  assert.equal(updates[0].capiDatasetId, "ds9", "dataset id is remembered");
  assert.match(posts[0].url, /\/ds9\/events$/);
  assert.equal(posts[0].body.data[0].user_data.ctwa_clid, "clid");
  assert.equal(audits[0].eventType, AD_ORDER_EVENT);
  assert.equal(audits[0].payload.adSourceId, "120200001");
  assert.equal(audits[0].payload.capi, "sent");
  assert.equal((await recordWhatsAppAdOrder({ shopDomain: "shop.myshopify.com", order }, setup({ existing: { id: "a" } }).deps)).outcome, "already_recorded");
});

test("without the switch the sale is only recorded; rejections and non-ad orders are handled", async () => {
  const off = setup({ account: { adConversionsEnabled: false } });
  assert.equal((await recordWhatsAppAdOrder({ shopDomain: "s", order }, off.deps)).outcome, "recorded");
  assert.equal(off.posts.length, 0);
  assert.equal(off.audits[0].payload.capi, "off");

  const rejected = setup({ capiOk: false });
  const result = await recordWhatsAppAdOrder({ shopDomain: "s", order }, rejected.deps);
  assert.equal(result.outcome, "report_failed");
  assert.equal(rejected.audits[0].payload.capiError, "Invalid parameter");

  assert.equal((await recordWhatsAppAdOrder({ shopDomain: "s", order }, setup({ chats: [] }).deps)).outcome, "not_from_ad");
});

test("the assistant is told about a recent ad, not an old one", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  assert.equal(adContextFor({ adHeadline: "Modest swimwear", adBody: "Full coverage", adReferredAt: new Date(now.getTime() - DAY) }, now), '"Modest swimwear" (Full coverage)');
  assert.equal(adContextFor({ adHeadline: "Old", adBody: null, adReferredAt: new Date(now.getTime() - 5 * DAY) }, now), null);
  const prompt = buildUserPrompt({ storeName: "Shop", storeUrl: null, policies: [], merchantNotes: null, products: [], orders: [], adContext: '"Modest swimwear"' }, [{ from: "customer", text: "price?" }], now);
  assert.match(prompt, /AD: the customer came to WhatsApp from our ad "Modest swimwear"/);
});
