/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __setLiveUsageEstimatePrismaForTests, getCurrentLiveUsageEstimate } from "./live-usage-estimate.ts";

const d = (value: string) => new Date(value);
function fixture() {
  const plan = { id: "plan-a", code: "STARTER", name: "Starter", currency: "USD", monthlyBasePrice: "9.99", active: true, features: [
    { id: "pf-otp", active: true, includedQuantity: "2", overageUnitPrice: "0.125", billableFeature: { id: "otp", code: "OTP", name: "One-time passwords", active: true } },
    { id: "pf-email", active: true, includedQuantity: "10", overageUnitPrice: "0.01", billableFeature: { id: "email", code: "EMAIL", name: "Email", active: true } },
  ] };
  const subscription: any = { id: "sub-a", shopId: "shop-a", status: "ACTIVE", currentPeriodStart: d("2026-07-01T00:00:00Z"), currentPeriodEnd: d("2026-08-01T00:00:00Z"), canceledAt: null, cancellationEffectiveAt: null, pricingPlan: plan };
  const period: any = { id: "period-a", shopId: "shop-a", subscriptionId: "sub-a", periodStart: d("2026-07-01T00:00:00Z"), periodEnd: d("2026-08-01T00:00:00Z"), status: "OPEN", subscription };
  const db: any = { merchantSubscription: { async findMany({ where }: any) { return where.shopId === "shop-a" ? [subscription] : []; } }, merchantBillingPeriod: { async findFirst({ where }: any) { return where.shopId === "shop-a" && where.periodStart.lte >= period.periodStart && where.periodEnd.gt <= period.periodEnd ? period : null; } }, merchantUsageEvent: { async groupBy({ where }: any) { assert.equal(where.shopId, "shop-a"); assert.deepEqual(where.provider.in, ["PLATFORM_TWILIO", "PLATFORM_RESEND", "PLATFORM_MSG91"]); return [{ usageType: "OTP", _sum: { quantity: "3.5" }, _count: { _all: 2 } }, { usageType: "EMAIL", _sum: { quantity: "1" }, _count: { _all: 1 } }]; } } };
  __setLiveUsageEstimatePrismaForTests(db); return { db, period };
}
beforeEach(fixture);
test("calculates a tenant-scoped, decimal-safe platform usage estimate without writes", async () => {
  const estimate = await getCurrentLiveUsageEstimate({ shopId: "shop-a", asOf: d("2026-07-15T00:00:00Z") });
  assert.ok(estimate); assert.equal(estimate.currency, "USD"); assert.equal(estimate.features[0].featureCode, "EMAIL");
  assert.deepEqual(estimate.features.map((feature) => [feature.featureCode, feature.usageQuantity, feature.billableQuantity, feature.estimatedCharge.amount, feature.usageEventCount]), [["EMAIL", "1", "0", "0", 1], ["OTP", "3.5", "1.5", "0.1875", 2]]);
  assert.equal(estimate.estimatedUsageChargeAmount.amount, "0.1875"); assert.equal(estimate.estimatedTotalAmount.amount, "10.1775"); assert.equal(estimate.isFinal, false);
});
test("returns null for another tenant, before the period, and at the half-open end boundary", async () => {
  assert.equal(await getCurrentLiveUsageEstimate({ shopId: "shop-b", asOf: d("2026-07-15T00:00:00Z") }), null);
  assert.equal(await getCurrentLiveUsageEstimate({ shopId: "shop-a", asOf: d("2026-08-01T00:00:00Z") }), null);
});
