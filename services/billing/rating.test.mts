/* eslint-disable @typescript-eslint/no-explicit-any -- Lightweight in-memory Prisma fixture. */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __setCommercialRatingPrismaForTests, getRatedBillingPeriod, rateBillingPeriod, usageTypeToFeatureCode } from "./rating.ts";

const d = (value: string) => new Date(value);
type Row = Record<string, any>;
function makeDb(status = "OPEN") {
  const period: Row = { id: "period-a", shopId: "shop-a", subscriptionId: "sub-a", periodStart: d("2026-07-01T00:00:00Z"), periodEnd: d("2026-08-01T00:00:00Z"), status, ratedAt: null, subscription: { shopId: "shop-a", pricingPlan: { id: "plan-a", code: "STARTER", name: "Starter", currency: "INR", active: true, features: [
    { id: "pf-otp", active: true, includedQuantity: "2", overageUnitPrice: "0.125", billableFeature: { id: "otp", code: "OTP", name: "One-time passwords", active: true } },
    { id: "pf-email", active: true, includedQuantity: "10", overageUnitPrice: "0", billableFeature: { id: "email", code: "EMAIL", name: "Email", active: true } },
  ] } } };
  const events: Row[] = [
    { shopId: "shop-a", usageType: "OTP", status: "RECORDED", quantity: "1.5", occurredAt: d("2026-07-01T00:00:00Z") },
    { shopId: "shop-a", usageType: "OTP", status: "RECORDED", quantity: "2", occurredAt: d("2026-07-15T00:00:00Z") },
    { shopId: "shop-a", usageType: "EMAIL", status: "RECORDED", quantity: "1", occurredAt: d("2026-07-15T00:00:00Z") },
    { shopId: "shop-a", usageType: "OTP", status: "RECORDED", quantity: "9", occurredAt: d("2026-08-01T00:00:00Z") },
    { shopId: "shop-a", usageType: "OTP", status: "REVERSED", quantity: "9", occurredAt: d("2026-07-15T00:00:00Z") },
    { shopId: "shop-b", usageType: "OTP", status: "RECORDED", quantity: "9", occurredAt: d("2026-07-15T00:00:00Z") },
  ]; const rated: Row[] = [];
  const db: any = {
    shop: { async findUnique({ where }: any) { return where.id === "shop-a" ? { id: "shop-a" } : null; } },
    merchantBillingPeriod: {
      async findUnique({ where }: any) { return where.id === "period-a" ? period : null; },
      async updateMany({ where, data }: any) { if (period.id === where.id && period.status === where.status) { Object.assign(period, data); return { count: 1 }; } return { count: 0 }; },
      async update({ data }: any) { Object.assign(period, data); return period; },
    },
    merchantUsageEvent: { async findMany({ where }: any) { return events.filter((e) => e.shopId === where.shopId && e.status === where.status && e.occurredAt >= where.occurredAt.gte && e.occurredAt < where.occurredAt.lt); } },
    merchantRatedUsage: {
      async createMany({ data }: any) { for (const row of data) rated.push({ ...row, id: `rated-${rated.length}`, createdAt: new Date() }); return { count: data.length }; },
      async findMany({ where }: any) { return rated.filter((r) => r.shopId === where.shopId && r.billingPeriodId === where.billingPeriodId).sort((a, b) => a.featureCodeSnapshot.localeCompare(b.featureCodeSnapshot)); },
    },
    async $transaction(fn: any) { return fn(db); },
  }; __setCommercialRatingPrismaForTests(db); return { db, period, events, rated };
}
beforeEach(() => makeDb());
test("schema and migration define immutable rated usage relations and indexes", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../prisma/migrations/20260716000000_add_merchant_rated_usage/migration.sql", import.meta.url), "utf8");
  assert.match(schema, /model MerchantRatedUsage[\s\S]*usedQuantity\s+Decimal\s+@db.Decimal\(18, 6\)/);
  assert.match(schema, /@@unique\(\[billingPeriodId, billableFeatureId\]\)/); assert.match(schema, /merchantRatedUsages\s+MerchantRatedUsage\[\]/);
  assert.match(migration, /DECIMAL\(18,6\)/); assert.match(migration, /ON DELETE RESTRICT/);
});
test("rates recorded period usage with half-open bounds, allowance, snapshots, and decimal arithmetic", async () => {
  const { period, rated } = makeDb(); const result = await rateBillingPeriod("shop-a", "period-a");
  assert.equal(result.created, true); assert.equal(period.status, "RATED"); assert.ok(period.ratedAt); assert.equal(rated.length, 2);
  assert.deepEqual(result.features.map((f) => [f.featureCode, f.usedQuantity, f.billableQuantity, f.amount, f.usageEventCount]), [["EMAIL", "1", "0", "0", 1], ["OTP", "3.5", "1.5", "0.1875", 2]]);
  assert.equal(result.totals.usageAmount, "0.1875"); assert.equal(rated[0].planCodeSnapshot, "STARTER"); assert.equal(rated[0].currency, "INR");
});
test("returns immutable existing rows and prevents second active rating", async () => {
  makeDb(); await rateBillingPeriod("shop-a", "period-a"); const again = await rateBillingPeriod("shop-a", "period-a"); assert.equal(again.created, false);
  makeDb("RATING"); await assert.rejects(() => rateBillingPeriod("shop-a", "period-a"), /RATING_IN_PROGRESS/);
});
test("enforces ownership and safely rejects missing pricing configuration", async () => {
  makeDb(); await assert.rejects(() => rateBillingPeriod("missing", "period-a"), /SHOP_NOT_FOUND/); await assert.rejects(() => rateBillingPeriod("shop-a", "missing"), /BILLING_PERIOD_NOT_FOUND/);
  const { period } = makeDb(); period.subscription.pricingPlan.features = []; await assert.rejects(() => rateBillingPeriod("shop-a", "period-a"), /FEATURE_PRICING_MISSING/); assert.equal(period.status, "RATING");
});
test("query helper is shop scoped and mapping is explicit", async () => {
  makeDb(); await rateBillingPeriod("shop-a", "period-a"); assert.equal((await getRatedBillingPeriod("shop-a", "period-a"))?.created, false); assert.equal(await getRatedBillingPeriod("shop-b", "period-a"), null);
  assert.deepEqual(usageTypeToFeatureCode, { OTP: "OTP", EMAIL: "EMAIL", SMS: "SMS", WHATSAPP: "WHATSAPP", AI: "AI", DELIVERY_LOOKUP: "DELIVERY_LOOKUP", CHECKOUT_TRANSACTION: "CHECKOUT" });
});
