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
const env = { WHATSAPP_RECOVERY_ENABLED: "true", WHATSAPP_RECOVERY_SHOPS: "bigonbuy-fashions.myshopify.com", CHECKOUT_RECOVERY_SIGNING_SECRET: SECRET };

test("run sends the first message with a signed bag-link token and records it", async () => {
  const db = fakeDb();
  const sends: any[] = [];
  const summary = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, {
    db: db as any, env, listCheckouts: async () => [node()] as any, isOptedOut: async () => false,
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
    env, listCheckouts: async () => [node()] as any, isOptedOut: async () => false,
    sendTemplate: async () => { throw new Error("must not send"); },
  });
  assert.equal(again.sentFirst + again.sentReminder, 0);
});

test("run sends nothing when disabled or the customer opted out, and retries a failed send", async () => {
  const off = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, { db: fakeDb() as any, env: { ...env, WHATSAPP_RECOVERY_ENABLED: "" }, listCheckouts: async () => [node()] as any, sendTemplate: async () => { throw new Error("no"); } });
  assert.equal(off.enabled, false);

  const optedOut = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, { db: fakeDb() as any, env, listCheckouts: async () => [node()] as any, isOptedOut: async () => true, sendTemplate: async () => { throw new Error("no"); } });
  assert.equal(optedOut.skippedOptOut, 1);

  const db = fakeDb();
  const failed = await runWhatsAppCheckoutRecovery({ now: new Date(T0 + 20 * MIN) }, { db: db as any, env, listCheckouts: async () => [node()] as any, isOptedOut: async () => false, sendTemplate: async () => ({ success: false }) });
  assert.equal(failed.failed, 1);
  assert.equal(db.events.length, 0, "nothing recorded, so the next run retries");
});
