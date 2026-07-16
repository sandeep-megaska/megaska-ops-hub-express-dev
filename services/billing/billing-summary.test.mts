import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __setBillingSummaryPrismaForTests,
  BillingCurrencyMismatchError,
  getBillingPeriodSummary,
  getCurrentBillingPeriodSummary,
  getCurrentFeatureUsageSummary,
  getCurrentMerchantSubscriptionSummary,
  listBillingPeriodSummaries,
} from "./billing-summary.ts";

const at = (value: string) => new Date(value);
const plan = { id: "plan-a", code: "PRO", name: "Professional", currency: "INR", monthlyBasePrice: "999.123456" };
const subscription = { id: "sub-a", shopId: "shop-a", status: "ACTIVE", billingProvider: "INTERNAL", createdAt: at("2026-01-01T00:00:00.000Z"), currentPeriodStart: at("2026-01-01T00:00:00.000Z"), currentPeriodEnd: at("2027-01-01T00:00:00.000Z"), canceledAt: null, cancellationEffectiveAt: null, pricingPlan: plan };
function rated(id: string, code: string, amount: string, included = "10", used = "12", currency = "INR") { return { id, shopId: "shop-a", billingPeriodId: "period-current", billableFeatureId: `feature-${code}`, featureCodeSnapshot: code, featureNameSnapshot: `${code} feature`, currency, usedQuantity: used, includedQuantity: included, billableQuantity: "2", unitRate: amount === "0" ? "0" : "1.250000", amount, usageEventCount: 3 }; }
const current = { id: "period-current", shopId: "shop-a", subscriptionId: "sub-a", periodStart: at("2026-06-01T00:00:00.000Z"), periodEnd: at("2026-07-01T00:00:00.000Z"), status: "RATED", subscription, ratedUsages: [rated("ru-email", "EMAIL", "2.500000"), rated("ru-otp", "OTP", "0")] };

function matches(row: typeof current, where: Record<string, unknown>) {
  if (row.shopId !== where.shopId) return false;
  if (typeof where.id === "string" && row.id !== where.id) return false;
  const start = where.periodStart as { lte?: Date; lt?: Date } | undefined;
  const end = where.periodEnd as { gt?: Date } | undefined;
  if (start?.lte && row.periodStart > start.lte) return false;
  if (start?.lt && row.periodStart >= start.lt) return false;
  if (end?.gt && row.periodEnd <= end.gt) return false;
  const or = where.OR as Array<Record<string, unknown>> | undefined;
  if (or && !or.some((item) => {
    const itemStart = item.periodStart as Date | { lt?: Date };
    return itemStart instanceof Date ? row.periodStart.getTime() === itemStart.getTime() && row.id < (item.id as { lt: string }).lt : Boolean(itemStart.lt && row.periodStart < itemStart.lt);
  })) return false;
  return true;
}

function makeDb(periods = [current]) {
  const writes = 0;
  const db = {
    get writes() { return writes; },
    merchantSubscription: { async findFirst(args: unknown) {
      const query = args as { where: { shopId: string } };
      return query.where.shopId === "shop-a" ? subscription : null;
    } },
    merchantBillingPeriod: {
      async findFirst(args: unknown) {
        const query = args as { where: Record<string, unknown> };
        return periods.find((period) => matches(period, query.where)) ?? null;
      },
      async findMany(args: unknown) {
        const query = args as { where: Record<string, unknown>; take: number };
        return periods.filter((period) => matches(period, query.where)).sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime() || b.id.localeCompare(a.id)).slice(0, query.take);
      },
    },
  };
  __setBillingSummaryPrismaForTests(db);
  return db;
}

beforeEach(() => makeDb());

test("resolves only an active subscription for its shop and as-of lifecycle", async () => {
  assert.equal((await getCurrentMerchantSubscriptionSummary({ shopId: "shop-a", asOf: at("2026-06-15") }))?.subscriptionId, "sub-a");
  assert.equal(await getCurrentMerchantSubscriptionSummary({ shopId: "shop-b", asOf: at("2026-06-15") }), null);
  assert.equal(await getCurrentMerchantSubscriptionSummary({ shopId: "shop-a", asOf: at("2027-01-01") }), null);
});

test("current period preserves half-open boundaries and performs no writes", async () => {
  const db = makeDb();
  const summary = await getCurrentBillingPeriodSummary({ shopId: "shop-a", asOf: at("2026-06-15") });
  assert.equal(summary?.billingPeriodId, "period-current");
  assert.equal(await getCurrentBillingPeriodSummary({ shopId: "shop-a", asOf: at("2026-07-01") }), null);
  assert.equal(db.writes, 0);
});

test("aggregates immutable rated snapshots with precise decimal totals and deterministic features", async () => {
  const summary = await getBillingPeriodSummary({ shopId: "shop-a", billingPeriodId: "period-current" });
  assert.deepEqual(summary?.features.map((feature) => feature.featureCode), ["EMAIL", "OTP"]);
  assert.equal(summary?.features[0].includedQuantity, "10");
  assert.equal(summary?.features[0].ratedAmount.amount, "2.5");
  assert.equal(summary?.usageChargeAmount.amount, "2.5");
  assert.equal(summary?.estimatedTotalAmount.amount, "1001.623456");
  assert.equal(summary?.totalUsageEventCount, 6);
  assert.equal((await getCurrentFeatureUsageSummary({ shopId: "shop-a", featureCode: "OTP", asOf: at("2026-06-15") }))?.ratedAmount.amount, "0");
});

test("enforces tenant isolation and rejects mixed-currency rated data", async () => {
  assert.equal(await getBillingPeriodSummary({ shopId: "shop-b", billingPeriodId: "period-current" }), null);
  const mixed = { ...current, ratedUsages: [rated("ru-usd", "EMAIL", "1.000000", "10", "12", "USD")] };
  makeDb([mixed]);
  await assert.rejects(() => getBillingPeriodSummary({ shopId: "shop-a", billingPeriodId: "period-current" }), BillingCurrencyMismatchError);
});

test("uses bounded stable tenant-scoped cursor pagination", async () => {
  const periods = [0, 1, 2].map((offset) => ({ ...current, id: `period-${offset}`, periodStart: at(`2026-0${6 - offset}-01T00:00:00.000Z`), ratedUsages: current.ratedUsages.map((row) => ({ ...row, billingPeriodId: `period-${offset}` })) }));
  makeDb(periods);
  const first = await listBillingPeriodSummaries({ shopId: "shop-a", limit: 2 });
  const second = await listBillingPeriodSummaries({ shopId: "shop-a", limit: 2, cursor: first.nextCursor ?? undefined });
  assert.deepEqual(first.items.map((item) => item.billingPeriodId), ["period-0", "period-1"]);
  assert.deepEqual(second.items.map((item) => item.billingPeriodId), ["period-2"]);
  assert.equal((await listBillingPeriodSummaries({ shopId: "shop-b" })).items.length, 0);
});
