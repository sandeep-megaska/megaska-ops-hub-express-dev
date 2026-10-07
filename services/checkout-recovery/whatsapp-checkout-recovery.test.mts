/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { verifyCodRecoveryToken } from "./prepaid-cod-recovery.ts";
import { dueStep, runWhatsAppCheckoutRecovery, selectRecoverableCheckouts, WHATSAPP_RECOVERY_EVENT } from "./whatsapp-checkout-recovery.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse("2026-10-06T10:00:00Z");
const SECRET = "x".repeat(40);

const checkout = (overrides: any = {}) => ({ checkoutId: "gid://shopify/AbandonedCheckout/1", phone: "919639390404", createdAt: T0 - 5 * MIN, updatedAt: T0, items: [{ variantId: 11, quantity: 1 }], ...overrides });

test("first message goes out once the checkout is idle 15 minutes, not before", () => {
  assert.equal(dueStep(checkout(), [], 0, T0 + 10 * MIN), null);
  assert.equal(dueStep(checkout(), [], 0, T0 + 15 * MIN), "first");
  assert.equal(dueStep(checkout(), [], 0, T0 + 29 * MIN), "first");
});

test("a first message that could not go out within 6 hours is skipped, not sent late", () => {
  assert.equal(dueStep(checkout(), [], 0, T0 + 7 * HOUR), null);
});

test("reminder goes out 24 hours after the first, once, and never a third message", () => {
  const first = [{ step: "first" as const, sentAt: T0 + 20 * MIN }];
  assert.equal(dueStep(checkout(), first, 1, T0 + 20 * MIN + 23 * HOUR), null);
  assert.equal(dueStep(checkout(), first, 1, T0 + 20 * MIN + 24 * HOUR), "reminder");
  const both = [...first, { step: "reminder" as const, sentAt: T0 + 20 * MIN + 24 * HOUR }];
  assert.equal(dueStep(checkout(), both, 2, T0 + 72 * HOUR), null);
  assert.equal(dueStep(checkout(), first, 1, T0 + 20 * MIN + 31 * HOUR), null, "a late reminder is dropped");
});

test("a phone gets at most two recovery messages in 7 days across checkouts", () => {
  assert.equal(dueStep(checkout({ checkoutId: "gid://shopify/AbandonedCheckout/2" }), [], 2, T0 + 20 * MIN), null);
  assert.equal(dueStep(checkout(), [{ step: "first", sentAt: T0 + 20 * MIN }], 2, T0 + 25 * HOUR), null);
});

const node = (overrides: any = {}) => ({
  id: "gid://shopify/AbandonedCheckout/1",
  createdAt: new Date(T0 - 5 * MIN).toISOString(),
  updatedAt: new Date(T0).toISOString(),
  completedAt: null,
  customAttributes: [{ key: "megaska_phone_verified", value: "true" }, { key: "megaska_verified_phone", value: "+91 96393 90404" }],
  customer: { lastOrder: null },
  lineItems: { nodes: [{ quantity: 2, variant: { id: "gid://shopify/ProductVariant/11" } }] },
  ...overrides,
});

test("only OTP-verified, uncompleted checkouts without a newer order qualify", () => {
  assert.deepEqual(selectRecoverableCheckouts([node()]).map((c) => [c.phone, c.items]), [["919639390404", [{ variantId: 11, quantity: 2 }]]]);
  assert.equal(selectRecoverableCheckouts([node({ completedAt: new Date(T0).toISOString() })]).length, 0);
  assert.equal(selectRecoverableCheckouts([node({ customAttributes: [{ key: "megaska_verified_phone", value: "9639390404" }] })]).length, 0, "phone not verified");
  assert.equal(selectRecoverableCheckouts([node({ customer: { lastOrder: { createdAt: new Date(T0).toISOString() } } })]).length, 0, "ordered since");
  assert.equal(selectRecoverableCheckouts([node({ lineItems: { nodes: [] } })]).length, 0);
});

function fakeDb(events: any[] = []) {
  return {
    events,
    shop: { findMany: async () => [{ id: "shop-1", shopDomain: "bigonbuy-fashions.myshopify.com" }] },
    auditEvent: {
      findMany: async () => events,
      create: async ({ data }: any) => { events.push({ ...data, createdAt: new Date() }); },
    },
  };
}
const env = { CHECKOUT_RECOVERY_SIGNING_SECRET: SECRET };
const account: any = { shopId: "shop-1", enabled: true, recoveryEnabled: true, phoneNumberId: "111111111111111" };
const sender: any = { source: "MERCHANT", accessToken: "token", phoneNumberId: "111111111111111", languageCode: "en", templates: { recoveryFirst: "checkout_recovery", recoveryReminder: "checkout_recovery_reminder" } };
const accounts = { listAccounts: async () => [account], senderFor: () => sender };

test("run sends the first message with a signed bag-link token and records it", async () => {
  const db = fakeDb();
  const sends: any[] = [];
  const summary = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, {
    ...accounts, db: db as any, env, listCheckouts: async () => [node()] as any, isOptedOut: async () => false,
    sendTemplate: async (input) => { sends.push(input); return { success: true, messageId: "wamid.1" }; },
  });
  assert.equal(summary.sentFirst, 1);
  assert.equal(sends[0].templateName, "checkout_recovery");
  assert.equal(sends[0].toPhone, "919639390404");
  assert.deepEqual(verifyCodRecoveryToken(sends[0].token, { shopId: "shop-1", now: new Date(T0) }, SECRET)?.items, [{ variantId: 11, quantity: 2 }]);
  assert.equal(db.events[0].eventType, WHATSAPP_RECOVERY_EVENT);
  assert.equal(db.events[0].payload.step, "first");

  // The next cron run 15 minutes later sends nothing more.
  const again = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 35 * MIN) }, {
    db: { ...db, auditEvent: { ...db.auditEvent, findMany: async () => db.events.map((e: any) => ({ ...e, createdAt: new Date(T0 + 20 * MIN) })) } } as any,
    ...accounts, env, listCheckouts: async () => [node()] as any, isOptedOut: async () => false,
    sendTemplate: async () => { throw new Error("must not send"); },
  });
  assert.equal(again.sentFirst + again.sentReminder, 0);
});

test("run sends nothing without a shop number with recovery on, or when the customer opted out, and retries a failed send", async () => {
  const none = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, { db: fakeDb() as any, env, listAccounts: async () => [], listCheckouts: async () => [node()] as any, sendTemplate: async () => { throw new Error("no"); } });
  assert.equal(none.shops, 0);

  const noSecret = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, { ...accounts, db: fakeDb() as any, env: {}, listCheckouts: async () => [node()] as any, sendTemplate: async () => { throw new Error("no"); } });
  assert.equal(noSecret.enabled, false);

  let optOutCheckedFor = "";
  const optedOut = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, { ...accounts, db: fakeDb() as any, env, listCheckouts: async () => [node()] as any, isOptedOut: async (_phone, senderId) => { optOutCheckedFor = senderId; return true; }, sendTemplate: async () => { throw new Error("no"); } });
  assert.equal(optedOut.skippedOptOut, 1);
  assert.equal(optOutCheckedFor, "111111111111111", "opt-out is checked against the shop's own number");

  const db = fakeDb();
  const failed = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, { ...accounts, db: db as any, env, listCheckouts: async () => [node()] as any, isOptedOut: async () => false, sendTemplate: async () => ({ success: false }) });
  assert.equal(failed.failed, 1);
  assert.equal(db.events.length, 0, "nothing recorded, so the next run retries");
});

test("run sends from the shop's own number", async () => {
  const sends: any[] = [];
  await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, { ...accounts, db: fakeDb() as any, env, listCheckouts: async () => [node()] as any, isOptedOut: async () => false, sendTemplate: async (input) => { sends.push(input); return { success: true }; } });
  assert.equal(sends[0].sender.phoneNumberId, "111111111111111");
  assert.equal(sends[0].sender.source, "MERCHANT");
});

test("a shopper with two open checkouts gets one message, for the most recent checkout", async () => {
  const older = node({ id: "gid://shopify/AbandonedCheckout/1", createdAt: new Date(T0 - 7 * 24 * HOUR).toISOString(), updatedAt: new Date(T0 - 30 * MIN).toISOString() });
  const newer = node({ id: "gid://shopify/AbandonedCheckout/2", updatedAt: new Date(T0).toISOString() });
  assert.deepEqual(selectRecoverableCheckouts([older, newer] as any).map((c) => c.checkoutId), ["gid://shopify/AbandonedCheckout/2"]);

  const sends: any[] = [];
  const summary = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, { ...accounts, db: fakeDb() as any, env, listCheckouts: async () => [newer, older] as any, isOptedOut: async () => false, sendTemplate: async (input) => { sends.push(input); return { success: true }; } });
  assert.equal(summary.sentFirst, 1);
  assert.equal(sends[0].checkoutId, "gid://shopify/AbandonedCheckout/2");
});

test("no new first message within 24 hours of another recovery message to the same phone", async () => {
  const earlier = [{ eventType: WHATSAPP_RECOVERY_EVENT, entityId: "gid://shopify/AbandonedCheckout/9", createdAt: new Date(T0 - 2 * HOUR), payload: { shopId: "shop-1", step: "first", phone: "919639390404" } }];
  const summary = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, { ...accounts, db: fakeDb(earlier) as any, env, listCheckouts: async () => [node()] as any, isOptedOut: async () => false, sendTemplate: async () => { throw new Error("must not send"); } });
  assert.equal(summary.sentFirst, 0);
});
