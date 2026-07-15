/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { recordAcceptedEmailUsage } from "./email-usage.ts";

function db(shopIds = ["shop-a"]) {
  const events = new Map<string, any>();
  return {
    events,
    shop: { findUnique: async ({ where }: any) => shopIds.includes(where.id) ? { id: where.id } : null },
    merchantUsageEvent: {
      findUnique: async ({ where, select }: any) => {
        const found = events.get(where.idempotencyKey);
        if (!found) return null;
        return select ? Object.fromEntries(Object.keys(select).map((k) => [k, found[k]])) : found;
      },
      create: async ({ data, select }: any) => {
        const row = { id: `usage-${events.size + 1}`, billingStatus: "UNRATED", createdAt: new Date(), updatedAt: new Date(), ...data, quantity: data.quantity.toString() };
        events.set(row.idempotencyKey, row);
        return select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row;
      },
    },
  } as any;
}

const base = {
  shopId: "shop-a",
  notificationAudience: "ADMIN" as const,
  eventType: "CANCELLATION",
  providerMessageId: "msg_123",
  notificationAttemptId: "attempt-1",
  recipientCount: 2,
  sourceType: "CANCELLATION_REQUEST",
  sourceId: "req-1",
  idempotencyKey: "usage:email-send:shop-a:cancellation:req-1:request-created-admin",
};

test("records accepted admin email usage with generic email dimensions and safe metadata", async () => {
  const h = db();
  const result = await recordAcceptedEmailUsage(base, h);
  const row = h.events.get(base.idempotencyKey);
  assert.deepEqual(result, { eventId: "usage-1", created: true });
  assert.equal(row.usageType, "EMAIL");
  assert.equal(row.action, "EMAIL_SEND");
  assert.equal(row.provider, "PLATFORM_RESEND");
  assert.equal(row.quantity, "1");
  assert.equal(row.billingStatus, "UNRATED");
  assert.equal(row.providerReference, "msg_123");
  assert.deepEqual(row.metadata, { audience: "ADMIN", eventType: "CANCELLATION", recipientCount: 2, transport: "resend" });
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /customer@example\.com|Subject|message body/i);
});

test("records customer audience and recipient count as metadata only", async () => {
  const h = db();
  await recordAcceptedEmailUsage({ ...base, notificationAudience: "CUSTOMER", idempotencyKey: "usage:email-send:shop-a:wallet:tx-1:credit-issued-customer", sourceType: "WALLET_TRANSACTION", sourceId: "tx-1", recipientCount: 1 }, h);
  const row = h.events.get("usage:email-send:shop-a:wallet:tx-1:credit-issued-customer");
  assert.equal(row.quantity, "1");
  assert.equal(row.metadata.audience, "CUSTOMER");
  assert.equal(row.metadata.recipientCount, 1);
});

test("duplicate stable idempotency returns existing event without increasing quantity", async () => {
  const h = db(["shop-a", "shop-b"]);
  await recordAcceptedEmailUsage(base, h);
  const duplicate = await recordAcceptedEmailUsage({ ...base, providerMessageId: "msg_456", recipientCount: 99 }, h);
  const row = h.events.get(base.idempotencyKey);
  assert.deepEqual(duplicate, { eventId: "usage-1", created: false });
  assert.equal(row.quantity, "1");
  assert.equal(row.providerReference, "msg_123");
});

test("shop usage is isolated by idempotency key", async () => {
  const h = db(["shop-a", "shop-b"]);
  await recordAcceptedEmailUsage(base, h);
  await recordAcceptedEmailUsage({ ...base, shopId: "shop-b", idempotencyKey: "usage:email-send:shop-b:cancellation:req-1:request-created-admin" }, h);
  assert.equal(h.events.size, 2);
});

test("invalid shop and oversized metadata are rejected by generic service", async () => {
  await assert.rejects(() => recordAcceptedEmailUsage({ ...base, shopId: "missing" }, db()), /Unable to resolve/);
  await assert.rejects(() => recordAcceptedEmailUsage({ ...base, eventType: "x".repeat(4097) }, db()), /metadata/);
});

test("derives provider-message and attempt idempotency when no stable source is supplied", async () => {
  const h = db();
  await recordAcceptedEmailUsage({ shopId: "shop-a", notificationAudience: "ADMIN", eventType: "GENERAL", providerMessageId: "msg_generic", notificationAttemptId: "attempt-2", recipientCount: 1 }, h);
  await recordAcceptedEmailUsage({ shopId: "shop-a", notificationAudience: "ADMIN", eventType: "GENERAL", providerMessageId: null, notificationAttemptId: "attempt-3", recipientCount: 1 }, h);
  assert.ok(h.events.get("usage:email-send:shop-a:resend:msg_generic"));
  assert.ok(h.events.get("usage:email-send:shop-a:attempt:attempt-3"));
});
