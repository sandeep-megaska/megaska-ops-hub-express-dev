import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  __setMerchantBillingPeriodPrismaForTests,
  closeMerchantBillingPeriod,
  getCurrentBillingPeriod,
  MerchantBillingPeriodStateError,
  MerchantBillingPeriodValidationError,
  openMerchantBillingPeriod,
  voidMerchantBillingPeriod,
} from "./periods.ts";

const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../prisma/migrations/20260715040000_add_merchant_billing_period_foundation/migration.sql", import.meta.url), "utf8");
type PeriodRow = { id: string; shopId: string; subscriptionId: string; periodStart: Date; periodEnd: Date; status: "OPEN" | "RATING" | "RATED" | "CLOSED" | "VOID"; openedAt: Date; ratedAt: Date | null; closedAt: Date | null; voidedAt: Date | null; createdAt: Date; updatedAt: Date };
type QueryArgs = { where?: Record<string, unknown>; orderBy?: { periodStart?: "asc" | "desc" }; data?: Record<string, unknown> };
const d = (value: string | Date) => new Date(value);

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} model should exist`);
  return match[0];
}

function enumBlock(name: string) {
  const match = schema.match(new RegExp(`enum ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} enum should exist`);
  return match[0];
}

function makeDb() {
  const shops = new Map([["shop-a", { id: "shop-a" }], ["shop-b", { id: "shop-b" }], ["shop-virtual", { id: "shop-virtual" }]]);
  const subscriptions = new Map([["shop-a", { id: "sub-a", shopId: "shop-a" }], ["shop-b", { id: "sub-b", shopId: "shop-b" }]]);
  const periods = new Map<string, PeriodRow>();
  let counter = 0;
  const matches = (row: PeriodRow, where: Record<string, unknown> = {}) => {
    const status = where.status as { not?: string } | undefined;
    const periodStart = where.periodStart as { lt?: Date; lte?: Date } | undefined;
    const periodEnd = where.periodEnd as { gt?: Date } | undefined;
    if (typeof where.id === "string" && row.id !== where.id) return false;
    if (typeof where.shopId === "string" && row.shopId !== where.shopId) return false;
    if (typeof where.subscriptionId === "string" && row.subscriptionId !== where.subscriptionId) return false;
    if (status?.not && row.status === status.not) return false;
    if (periodStart?.lt && !(row.periodStart < periodStart.lt)) return false;
    if (periodStart?.lte && !(row.periodStart <= periodStart.lte)) return false;
    if (periodEnd?.gt && !(row.periodEnd > periodEnd.gt)) return false;
    return true;
  };
  const db = {
    shops, subscriptions, periods,
    shop: { async findUnique(args: unknown) { const query = args as { where: { id: string } }; return shops.get(query.where.id) ?? null; } },
    merchantSubscription: { async findUnique(args: unknown) { const query = args as { where: { shopId: string } }; return subscriptions.get(query.where.shopId) ?? null; } },
    merchantBillingPeriod: {
      async findUnique(args: unknown) {
        const query = args as { where: { id?: string; subscriptionId_periodStart_periodEnd?: { subscriptionId: string; periodStart: Date; periodEnd: Date } } };
        if (query.where.id) return periods.get(query.where.id) ?? null;
        const key = query.where.subscriptionId_periodStart_periodEnd;
        if (key) return [...periods.values()].find((p) => p.subscriptionId === key.subscriptionId && p.periodStart.getTime() === key.periodStart.getTime() && p.periodEnd.getTime() === key.periodEnd.getTime()) ?? null;
        return null;
      },
      async findFirst(args: unknown) {
        const query = args as QueryArgs;
        const found = [...periods.values()].filter((row) => matches(row, query.where));
        found.sort((a, b) => query.orderBy?.periodStart === "desc" ? b.periodStart.getTime() - a.periodStart.getTime() : a.periodStart.getTime() - b.periodStart.getTime());
        return found[0] ?? null;
      },
      async create(args: unknown) {
        const query = args as { data: { shopId: string; subscriptionId: string; periodStart: Date; periodEnd: Date; status: "OPEN" } };
        const duplicate = [...periods.values()].find((p) => p.subscriptionId === query.data.subscriptionId && p.periodStart.getTime() === query.data.periodStart.getTime() && p.periodEnd.getTime() === query.data.periodEnd.getTime());
        if (duplicate) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        const now = new Date();
        const row: PeriodRow = { id: `period-${++counter}`, openedAt: now, ratedAt: null, closedAt: null, voidedAt: null, createdAt: now, updatedAt: now, ...query.data };
        periods.set(row.id, row);
        return row;
      },
      async update(args: unknown) {
        const query = args as { where: { id: string }; data: Partial<PeriodRow> & { status?: "OPEN" | "RATING" | "RATED" | "CLOSED" | "VOID" } };
        const row = periods.get(query.where.id);
        assert.ok(row, "period exists");
        Object.assign(row, query.data, { updatedAt: new Date() });
        return row;
      },
    },
  };
  __setMerchantBillingPeriodPrismaForTests(db);
  return db;
}

beforeEach(() => makeDb());

test("schema and migration add MerchantBillingPeriod foundation only", () => {
  assert.match(enumBlock("MerchantBillingPeriodStatus"), /OPEN[\s\S]*RATING[\s\S]*RATED[\s\S]*CLOSED[\s\S]*VOID/);
  const block = modelBlock("MerchantBillingPeriod");
  assert.match(block, /shopId\s+String/);
  assert.match(block, /subscriptionId\s+String/);
  assert.match(block, /@@unique\(\[subscriptionId, periodStart, periodEnd\]\)/);
  assert.match(modelBlock("Shop"), /merchantBillingPeriods\s+MerchantBillingPeriod\[\]/);
  assert.match(modelBlock("MerchantSubscription"), /billingPeriods\s+MerchantBillingPeriod\[\]/);
  assert.match(migration, /CREATE TYPE "MerchantBillingPeriodStatus" AS ENUM/);
  assert.match(migration, /CHECK \("periodEnd" > "periodStart"\)/);
  assert.doesNotMatch(schema, /model BillingInvoice|model BillingBatch/);
});

test("opens a valid persisted-subscription period and references correct shop/subscription", async () => {
  const period = await openMerchantBillingPeriod("shop-a", { periodStart: "2026-07-01T00:00:00.000Z", periodEnd: "2026-08-01T00:00:00.000Z" });
  assert.equal(period.shopId, "shop-a");
  assert.equal(period.subscriptionId, "sub-a");
  assert.equal(period.status, "OPEN");
});

test("missing shop and missing persisted subscription are rejected", async () => {
  await assert.rejects(() => openMerchantBillingPeriod("missing", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") }), MerchantBillingPeriodValidationError);
  await assert.rejects(() => openMerchantBillingPeriod("shop-virtual", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") }), /SUBSCRIPTION_REQUIRED/);
});

test("validates date order and maximum duration", async () => {
  await assert.rejects(() => openMerchantBillingPeriod("shop-a", { periodStart: "bad", periodEnd: d("2026-08-01Z") }), MerchantBillingPeriodValidationError);
  await assert.rejects(() => openMerchantBillingPeriod("shop-a", { periodStart: d("2026-08-01Z"), periodEnd: d("2026-07-01Z") }), MerchantBillingPeriodValidationError);
  await assert.rejects(() => openMerchantBillingPeriod("shop-a", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-07-01Z") }), MerchantBillingPeriodValidationError);
  await assert.rejects(() => openMerchantBillingPeriod("shop-a", { periodStart: d("2026-01-01Z"), periodEnd: d("2027-01-03Z") }), MerchantBillingPeriodValidationError);
});

test("duplicate open returns existing period without creating another row", async () => {
  const db = makeDb();
  const a = await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") });
  const b = await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") });
  assert.equal(a.id, b.id);
  assert.equal(db.periods.size, 1);
});

test("rejects later, earlier, contained, and containing overlaps", async () => {
  await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") });
  for (const [periodStart, periodEnd] of [["2026-07-15Z", "2026-08-15Z"], ["2026-06-15Z", "2026-07-15Z"], ["2026-07-10Z", "2026-07-20Z"], ["2026-06-01Z", "2026-09-01Z"]]) {
    await assert.rejects(() => openMerchantBillingPeriod("shop-a", { periodStart: d(periodStart), periodEnd: d(periodEnd) }), /BILLING_PERIOD_OVERLAP/);
  }
});

test("allows adjacent next and previous periods", async () => {
  await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") });
  await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-08-01Z"), periodEnd: d("2026-09-01Z") });
  await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-06-01Z"), periodEnd: d("2026-07-01Z") });
});

test("void periods do not block replacement periods", async () => {
  const p = await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") });
  await voidMerchantBillingPeriod("shop-a", p.id);
  const replacement = await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-07-15Z"), periodEnd: d("2026-08-15Z") });
  assert.equal(replacement.status, "OPEN");
});

test("current resolver uses half-open intervals and is shop scoped", async () => {
  const a = await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") });
  await openMerchantBillingPeriod("shop-b", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") });
  assert.equal((await getCurrentBillingPeriod("shop-a", d("2026-07-01Z")))?.id, a.id);
  assert.equal((await getCurrentBillingPeriod("shop-a", d("2026-07-15Z")))?.id, a.id);
  assert.equal(await getCurrentBillingPeriod("shop-a", d("2026-08-01Z")), null);
  assert.notEqual((await getCurrentBillingPeriod("shop-b", d("2026-07-15Z")))?.id, a.id);
  assert.equal(await getCurrentBillingPeriod("shop-virtual", d("2026-07-15Z")), null);
});

test("shop A cannot close, void, or read shop B period", async () => {
  const b = await openMerchantBillingPeriod("shop-b", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") });
  await assert.rejects(() => closeMerchantBillingPeriod("shop-a", b.id), MerchantBillingPeriodValidationError);
  await assert.rejects(() => voidMerchantBillingPeriod("shop-a", b.id), MerchantBillingPeriodValidationError);
  assert.equal(await getCurrentBillingPeriod("shop-a", d("2026-07-15Z")), null);
});

test("open period can be closed idempotently and sets closedAt", async () => {
  const p = await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") });
  const closed = await closeMerchantBillingPeriod("shop-a", p.id);
  assert.equal(closed.status, "CLOSED");
  assert.ok(closed.closedAt);
  assert.equal((await closeMerchantBillingPeriod("shop-a", p.id)).id, p.id);
});

test("open period can be voided idempotently, but closed cannot be voided", async () => {
  const p = await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-07-01Z"), periodEnd: d("2026-08-01Z") });
  const voided = await voidMerchantBillingPeriod("shop-a", p.id);
  assert.equal(voided.status, "VOID");
  assert.ok(voided.voidedAt);
  assert.equal((await voidMerchantBillingPeriod("shop-a", p.id)).id, p.id);
  const q = await openMerchantBillingPeriod("shop-a", { periodStart: d("2026-08-01Z"), periodEnd: d("2026-09-01Z") });
  await closeMerchantBillingPeriod("shop-a", q.id);
  await assert.rejects(() => voidMerchantBillingPeriod("shop-a", q.id), MerchantBillingPeriodStateError);
});

test("does not touch usage rating or external billing APIs", () => {
  assert.doesNotMatch(readFileSync(new URL("./periods.ts", import.meta.url), "utf8"), /MerchantUsageEvent|MerchantRatedUsage|shopify|stripe|razorpay/i);
});
