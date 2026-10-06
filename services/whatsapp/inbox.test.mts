/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { applyStatusUpdates, describeInbound, isWithinCustomerWindow, nextStatus, recordInboundMessages, recordOutboundMessage, sendInboxReply } from "./inbox.ts";

const BUSINESS = "111111111111111";
const T0 = Date.parse("2026-10-08T10:00:00Z");

function fakeDb(overrides: any = {}) {
  const conversations: any[] = [];
  const messages: any[] = [];
  const account = { shopId: "shop-1", enabled: true, phoneNumberId: BUSINESS, accessTokenEncrypted: "x", templateLanguage: "en", ...overrides.account };
  const key = (where: any) => where.businessPhoneNumberId_contactPhone;
  return {
    conversations, messages,
    merchantWhatsAppAccount: { findFirst: async ({ where }: any) => (where.phoneNumberId === account.phoneNumberId ? account : null), findUnique: async () => account },
    shop: { findUnique: async () => ({ id: "shop-1", shopDomain: "megaska.myshopify.com" }) },
    whatsAppConversation: {
      findUnique: async ({ where }: any) => conversations.find((c) => c.businessPhoneNumberId === key(where).businessPhoneNumberId && c.contactPhone === key(where).contactPhone) || null,
      findFirst: async ({ where }: any) => conversations.find((c) => c.id === where.id && c.shopId === where.shopId) || null,
      upsert: async ({ where, create, update }: any) => {
        const found = conversations.find((c) => c.businessPhoneNumberId === key(where).businessPhoneNumberId && c.contactPhone === key(where).contactPhone);
        if (!found) { const row = { id: `c${conversations.length + 1}`, contactName: null, lastInboundAt: null, unreadCount: 0, ...create }; conversations.push(row); return row; }
        for (const [field, value] of Object.entries(update)) (found as any)[field] = (value as any)?.increment ? (found as any)[field] + (value as any).increment : value;
        return found;
      },
      update: async ({ where, data }: any) => Object.assign(conversations.find((c) => c.id === where.id), data),
    },
    whatsAppMessage: {
      findUnique: async ({ where }: any) => messages.find((m) => m.waMessageId === where.waMessageId) || null,
      findFirst: async () => null,
      create: async ({ data }: any) => { messages.push({ id: `m${messages.length + 1}`, ...data }); },
      update: async ({ where, data }: any) => Object.assign(messages.find((m) => m.id === where.id), data),
    },
  };
}

const value = (messages: any[], name = "Asha") => ({ metadata: { phone_number_id: BUSINESS }, contacts: [{ wa_id: "919876543210", profile: { name } }], messages });
const textMessage = (id: string, body: string, seconds = T0 / 1000) => ({ from: "919876543210", id, timestamp: String(seconds), type: "text", text: { body } });

test("an inbound message creates the conversation, stores the message and emails the team once", async () => {
  const db = fakeDb();
  const alerts: any[] = [];
  const stored = await recordInboundMessages(value([textMessage("wamid.1", "Is size L available?")]), { db: db as any, alert: async (a) => { alerts.push(a); } });
  assert.equal(stored, 1);
  assert.equal(db.conversations[0].contactName, "Asha");
  assert.equal(db.conversations[0].contactPhone, "919876543210");
  assert.equal(db.conversations[0].unreadCount, 1);
  assert.equal(db.messages[0].body, "Is size L available?");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /Asha/);

  // A follow-up a minute later: stored, unread 2, no second email.
  await recordInboundMessages(value([textMessage("wamid.2", "And XL?", T0 / 1000 + 60)]), { db: db as any, alert: async (a) => { alerts.push(a); } });
  assert.equal(db.conversations[0].unreadCount, 2);
  assert.equal(alerts.length, 1);

  // Meta redelivers the same message: ignored.
  await recordInboundMessages(value([textMessage("wamid.2", "And XL?")]), { db: db as any, alert: async () => undefined });
  assert.equal(db.messages.length, 2);
});

test("messages to a number no shop owns are not stored", async () => {
  const db = fakeDb({ account: { phoneNumberId: "999" } });
  assert.equal(await recordInboundMessages(value([textMessage("wamid.1", "hi")]), { db: db as any, alert: async () => undefined }), 0);
});

test("media and other message types get a readable line and keep the media id", () => {
  assert.deepEqual(describeInbound({ type: "image", image: { id: "media-1" } }), { type: "image", body: "📷 Photo", mediaId: "media-1" });
  assert.deepEqual(describeInbound({ type: "audio", audio: { id: "media-2" } }), { type: "audio", body: "🎤 Voice message", mediaId: "media-2" });
  assert.equal(describeInbound({ type: "interactive", interactive: { button_reply: { title: "Yes" } } }).body, "Yes");
});

test("delivery ticks only move forward and failures keep the reason", async () => {
  assert.equal(nextStatus("read", "delivered"), "read");
  assert.equal(nextStatus("sent", "read"), "read");
  const db = fakeDb();
  db.messages.push({ id: "m1", waMessageId: "wamid.out", status: "sent" });
  await applyStatusUpdates({ statuses: [{ id: "wamid.out", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] }] }, { db: db as any });
  assert.equal(db.messages[0].status, "failed");
  assert.match(db.messages[0].errorMessage, /131047/);
});

test("replies are only allowed within 24 hours of the customer's last message", async () => {
  assert.equal(isWithinCustomerWindow(new Date(T0), new Date(T0 + 23 * 3600_000)), true);
  assert.equal(isWithinCustomerWindow(new Date(T0), new Date(T0 + 25 * 3600_000)), false);
  assert.equal(isWithinCustomerWindow(null), false);
  const db = fakeDb();
  db.conversations.push({ id: "c1", shopId: "shop-1", businessPhoneNumberId: BUSINESS, contactPhone: "919876543210", lastInboundAt: new Date(T0) });
  await assert.rejects(sendInboxReply({ shopId: "shop-1", conversationId: "c1", text: "Hi", now: new Date(T0 + 25 * 3600_000) }, { db: db as any, fetcher: (async () => { throw new Error("must not send"); }) as any }), /24 hours/);
  await assert.rejects(sendInboxReply({ shopId: "shop-2", conversationId: "c1", text: "Hi", now: new Date(T0) }, { db: db as any }), /not found/, "another shop cannot reply");
});

test("a reply goes out from the shop's own number and is recorded in the thread", async () => {
  const { encryptShopifyToken } = await import("../shopify/token-crypto.ts");
  process.env.TOKEN_ENCRYPTION_KEY ||= "test-key-for-inbox-tests-0123456789";
  const db = fakeDb({ account: { accessTokenEncrypted: encryptShopifyToken("merchant-token") } });
  db.conversations.push({ id: "c1", shopId: "shop-1", businessPhoneNumberId: BUSINESS, contactPhone: "919876543210", lastInboundAt: new Date(T0) });
  const calls: any[] = [];
  await sendInboxReply({ shopId: "shop-1", conversationId: "c1", text: "Yes, L is in stock!", now: new Date(T0 + 3600_000) }, {
    db: db as any,
    fetcher: (async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, json: async () => ({ messages: [{ id: "wamid.reply" }] }) }; }) as any,
  });
  assert.match(calls[0].url, new RegExp(`/${BUSINESS}/messages$`));
  assert.equal(calls[0].init.headers.Authorization, "Bearer merchant-token");
  assert.deepEqual(JSON.parse(calls[0].init.body).text, { preview_url: true, body: "Yes, L is in stock!" });
  const out = db.messages.find((m) => m.direction === "OUTBOUND");
  assert.equal(out.waMessageId, "wamid.reply");
  assert.equal(out.status, "sent");
});

test("automated template sends are recorded without touching unread or the reply window", async () => {
  const db = fakeDb();
  await recordOutboundMessage({ shopId: "shop-1", businessPhoneNumberId: BUSINESS, toPhone: "+91 98765 43210", waMessageId: "wamid.t", type: "template", body: "Template: checkout_recovery", templateName: "checkout_recovery" }, { db: db as any });
  assert.equal(db.conversations[0].contactPhone, "919876543210");
  assert.equal(db.conversations[0].unreadCount, 0);
  assert.equal(db.conversations[0].lastInboundAt, null);
});
