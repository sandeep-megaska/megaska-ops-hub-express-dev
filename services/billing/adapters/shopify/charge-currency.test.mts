import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { BILLING_CURRENCY_QUERY, chargePrice, storeBillingCurrency } from "./charge-currency.ts";

const plan = { amount: "4999", currency: "INR", usdAmount: "59" };

test("stores billed in the plan's currency pay the plan price", () => {
  assert.deepEqual(chargePrice(plan, "INR"), { amount: "4999", currency: "INR" });
  assert.deepEqual(chargePrice(plan, null), { amount: "4999", currency: "INR" }, "unknown billing currency keeps the plan price");
});

test("stores billed in another currency pay the USD price, or can't be charged without one", () => {
  assert.deepEqual(chargePrice(plan, "USD"), { amount: "59", currency: "USD" });
  assert.deepEqual(chargePrice(plan, "EUR"), { amount: "59", currency: "USD" });
  assert.equal(chargePrice({ ...plan, usdAmount: null }, "USD"), null);
  assert.equal(chargePrice({ ...plan, usdAmount: " " }, "USD"), null);
});

test("reads the store's billing currency and tolerates failures", async () => {
  const calls: string[] = [];
  const ok = async <T,>(query: string) => { calls.push(query); return { shopBillingPreferences: { currency: "usd" } } as T; };
  assert.equal(await storeBillingCurrency(ok, "dev.myshopify.com"), "USD");
  assert.deepEqual(calls, [BILLING_CURRENCY_QUERY]);
  assert.equal(await storeBillingCurrency(async <T,>() => ({ shopBillingPreferences: null }) as T, "x"), null);
  assert.equal(await storeBillingCurrency(async () => { throw new Error("network"); }, "x"), null);
});

test("the adapter charges the chosen price and the plan passes its USD price", () => {
  const adapter = fs.readFileSync(new URL("./shopify-billing-adapter.ts", import.meta.url), "utf8");
  assert.match(adapter, /const billingCurrency = await storeBillingCurrency\(this\.execute, shopDomain\);/);
  assert.match(adapter, /throw new BillingProviderValidationError\("BILLING_CURRENCY_UNSUPPORTED"/);
  assert.match(adapter, /price: \{ amount: basePrice\.toString\(\), currencyCode: code \}/);
  const lifecycle = fs.readFileSync(new URL("../../plans/plan-lifecycle.ts", import.meta.url), "utf8");
  assert.match(lifecycle, /usdMonthlyBasePrice: target\.usdMonthlyBasePrice\?\.toString\(\) \?\? null/);
  const route = fs.readFileSync(new URL("../../../../app/api/admin/billing/plan-route.ts", import.meta.url), "utf8");
  assert.match(route, /console\.error\("billing_provider_error", \{ code: error\.code, retryable: error\.retryable, message: error\.message \}\)/);
});
