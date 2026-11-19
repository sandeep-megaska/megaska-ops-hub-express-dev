import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../../generated/prisma/index.js";
import { __setBillingLifecyclePrismaForTests, usageChargeInChargeCurrency } from "./lifecycle.ts";

const plan = { currency: "INR", monthlyBasePrice: new Prisma.Decimal("2899"), usdMonthlyBasePrice: new Prisma.Decimal("29") };
__setBillingLifecyclePrismaForTests({ pricingPlan: { findUnique: async () => plan } });

test("usage stays in rupees when Shopify bills the store in rupees", async () => {
  assert.deepEqual(await usageChargeInChargeCurrency({ amount: "350.00", currency: "INR" }, { pricingPlanId: "p", providerMetadata: { chargeCurrency: "INR" } }), { amount: "350.00", currency: "INR" });
  assert.deepEqual(await usageChargeInChargeCurrency({ amount: "350.00", currency: "INR" }, { pricingPlanId: "p", providerMetadata: null }), { amount: "350.00", currency: "INR" }, "subscriptions approved before this change");
});

test("usage is converted at the plan's USD/INR price ratio for USD-billed stores", async () => {
  // ₹350 × 29 / 2899 = $3.50
  assert.deepEqual(await usageChargeInChargeCurrency({ amount: "350", currency: "INR" }, { pricingPlanId: "p", providerMetadata: { chargeCurrency: "USD" } }), { amount: "3.5", currency: "USD" });
});

test("conversion without a USD plan price fails instead of charging the wrong currency", async () => {
  __setBillingLifecyclePrismaForTests({ pricingPlan: { findUnique: async () => ({ ...plan, usdMonthlyBasePrice: null }) } });
  await assert.rejects(usageChargeInChargeCurrency({ amount: "350", currency: "INR" }, { pricingPlanId: "p", providerMetadata: { chargeCurrency: "USD" } }), /USAGE_CURRENCY_CONVERSION_UNAVAILABLE/);
});
