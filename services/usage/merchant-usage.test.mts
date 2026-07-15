/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { recordMerchantUsage, getMerchantUsageSummary, MerchantUsageValidationError } from "./merchant-usage.ts";

type Event = Record<string, any>;
function db(shopIds = ["shop-a"]) {
  const events = new Map<string, Event>();
  return {
    events,
    shop: { findUnique: async ({ where }: any) => shopIds.includes(where.id) ? { id: where.id } : null },
    merchantUsageEvent: {
      findUnique: async ({ where, select }: any) => {
        const found = events.get(where.idempotencyKey);
        if (!found) return null;
        if (!select) return found;
        return Object.fromEntries(Object.keys(select).map((k) => [k, found[k]]));
      },
      create: async ({ data, select }: any) => {
        const row = { id: `usage-${events.size + 1}`, status: "RECORDED", billingStatus: "UNRATED", createdAt: new Date(), updatedAt: new Date(), ...data, quantity: data.quantity.toString() };
        events.set(row.idempotencyKey, row);
        if (!select) return row;
        return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
      },
      aggregate: async ({ where }: any) => {
        const total = [...events.values()].filter((e) => e.shopId === where.shopId && e.occurredAt >= where.occurredAt.gte && e.occurredAt < where.occurredAt.lt && (!where.usageType || e.usageType === where.usageType)).reduce((sum, e) => sum + Number(e.quantity), 0);
        return { _sum: { quantity: total ? { toString: () => String(total) } : null } };
      },
      count: async ({ where }: any) => [...events.values()].filter((e) => e.shopId === where.shopId && e.occurredAt >= where.occurredAt.gte && e.occurredAt < where.occurredAt.lt && (!where.usageType || e.usageType === where.usageType)).length,
    },
  } as any;
}

const valid = { shopId: "shop-a", usageType: "OTP" as const, action: "OTP_REQUEST" as const, provider: "PLATFORM_TWILIO" as const, quantity: 1, sourceType: "OTP_CHALLENGE", sourceId: "challenge-a", idempotencyKey: "usage:otp-request:shop-a:challenge-a", occurredAt: new Date("2026-07-15T00:00:00Z"), metadata: { transportProvider: "twilio" } };

test("creates a usage event for a valid shop", async () => {
  const h = db();
  const result = await recordMerchantUsage(valid, h);
  assert.deepEqual(result, { eventId: "usage-1", created: true });
  assert.equal(h.events.get(valid.idempotencyKey).billingStatus, "UNRATED");
});

test("rejects unresolved shop", async () => await assert.rejects(() => recordMerchantUsage({ ...valid, shopId: "missing" }, db()), /Unable to resolve/));
test("rejects zero quantity", async () => await assert.rejects(() => recordMerchantUsage({ ...valid, quantity: 0 }, db()), /quantity/));
test("rejects negative quantity", async () => await assert.rejects(() => recordMerchantUsage({ ...valid, quantity: -1 }, db()), /quantity/));
test("rejects unsupported usage type", async () => await assert.rejects(() => recordMerchantUsage({ ...valid, usageType: "BAD" as any }, db()), /usageType/));
test("rejects unsupported action", async () => await assert.rejects(() => recordMerchantUsage({ ...valid, action: "BAD" as any }, db()), /action/));
test("rejects unsupported provider", async () => await assert.rejects(() => recordMerchantUsage({ ...valid, provider: "BAD" as any }, db()), /provider/));
test("requires source type", async () => await assert.rejects(() => recordMerchantUsage({ ...valid, sourceType: " " }, db()), /sourceType/));
test("requires source ID", async () => await assert.rejects(() => recordMerchantUsage({ ...valid, sourceId: "" }, db()), /sourceId/));
test("requires idempotency key", async () => await assert.rejects(() => recordMerchantUsage({ ...valid, idempotencyKey: "" }, db()), /idempotencyKey/));

test("duplicate idempotency returns existing event without changing immutable fields", async () => {
  const h = db(["shop-a", "shop-b"]);
  await recordMerchantUsage(valid, h);
  const duplicate = await recordMerchantUsage({ ...valid, shopId: "shop-b", quantity: 99 }, h);
  const row = h.events.get(valid.idempotencyKey);
  assert.deepEqual(duplicate, { eventId: "usage-1", created: false });
  assert.equal(row.quantity, "1");
  assert.equal(row.shopId, "shop-a");
});

test("shop usage is isolated and summary respects date range", async () => {
  const h = db(["shop-a", "shop-b"]);
  await recordMerchantUsage(valid, h);
  await recordMerchantUsage({ ...valid, shopId: "shop-b", sourceId: "challenge-b", idempotencyKey: "usage:otp-request:shop-b:challenge-b", occurredAt: new Date("2026-07-16T00:00:00Z") }, h);
  await recordMerchantUsage({ ...valid, sourceId: "challenge-old", idempotencyKey: "usage:otp-request:shop-a:challenge-old", occurredAt: new Date("2026-06-01T00:00:00Z") }, h);
  assert.deepEqual(await getMerchantUsageSummary({ shopId: "shop-a", usageType: "OTP", from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-08-01T00:00:00Z") }, h), { totalQuantity: "1", eventCount: 1 });
});

test("metadata size limit is enforced", async () => {
  await assert.rejects(() => recordMerchantUsage({ ...valid, metadata: { blob: "x".repeat(4097) } }, db()), /metadata/);
});

test("validation errors do not expose secrets", async () => {
  await assert.rejects(() => recordMerchantUsage({ ...valid, usageType: "SECRET_TOKEN" as any }, db()), (error) => error instanceof MerchantUsageValidationError && !String(error.message).includes("TOKEN"));
});
