/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { __setMerchantBillingAccountPrismaForTests, ensureMerchantBillingAccount } from "./merchant-billing-account.ts";
import { __setCommercialCatalogHealthPrismaForTests } from "./commercial-catalog-health.ts";

const plan: any = { id: "plan-1", code: "PROFESSIONAL", name: "Professional", currency: "INR", monthlyBasePrice: "999", active: true, features: [{ active: true, billableFeature: { code: "OTP", name: "OTP", active: true } }, { active: true, billableFeature: { code: "EMAIL", name: "Email", active: true } }] };
test("initializes a tenant-scoped pending Shopify account and only one current period", async () => {
  let subscription: any = null; const periods: any[] = [];
  __setMerchantBillingAccountPrismaForTests({
    shop: { async findUnique({ where }: any) { return where.id === "shop-a" ? { id: "shop-a", installationStatus: "PRODUCTION" } : null; } },
    pricingPlan: { async findUnique() { return plan; } },
    merchantSubscription: {
      async findUnique() { return subscription; },
      async upsert({ create }: any) { subscription = { id: "sub-a", ...create, pricingPlan: plan }; return subscription; },
      async update({ data }: any) { subscription = { ...subscription, ...data }; return subscription; },
    },
    merchantBillingPeriod: {
      async findFirst({ where }: any) { return periods.find((period) => period.shopId === where.shopId && period.subscriptionId === where.subscriptionId && period.periodStart.getTime() === where.periodStart.getTime() && period.periodEnd.getTime() === where.periodEnd.getTime()) ?? null; },
      async create({ data }: any) { const period = { id: `period-${periods.length + 1}`, ...data }; periods.push(period); return period; },
    },
  } as any);
  __setCommercialCatalogHealthPrismaForTests({ pricingPlan: { async findUnique() { return plan; } } } as any);
  const now = new Date("2026-01-31T10:00:00Z");
  const first = await ensureMerchantBillingAccount({ shopId: "shop-a", now });
  const second = await ensureMerchantBillingAccount({ shopId: "shop-a", now });
  assert.equal(first.subscription.billingProvider, "SHOPIFY"); assert.equal(first.subscription.status, "TRIALING");
  assert.equal(first.subscription.currentPeriodEnd!.toISOString(), "2026-02-28T10:00:00.000Z");
  assert.equal(first.period.id, second.period.id); assert.equal(periods.length, 1);
  await assert.rejects(() => ensureMerchantBillingAccount({ shopId: "shop-b", now }));
});

test("missing catalog does not create partial tenant subscription records", async () => {
  let subscriptionWrites = 0;
  __setCommercialCatalogHealthPrismaForTests({ pricingPlan: { async findUnique() { return null; } } } as any);
  __setMerchantBillingAccountPrismaForTests({
    shop: { async findUnique() { return { id: "shop-a", installationStatus: "PRODUCTION" }; } },
    pricingPlan: { async findUnique() { throw new Error("pricing plan should not be queried after failed health check"); } },
    merchantSubscription: { async findUnique() { return null; }, async upsert() { subscriptionWrites += 1; throw new Error("unexpected write"); }, async update() { throw new Error("unexpected write"); } },
    merchantBillingPeriod: { async findFirst() { return null; }, async create() { throw new Error("unexpected write"); } },
  } as any);
  await assert.rejects(() => ensureMerchantBillingAccount({ shopId: "shop-a" }), { name: "CommercialCatalogConfigurationError" });
  assert.equal(subscriptionWrites, 0);
});
