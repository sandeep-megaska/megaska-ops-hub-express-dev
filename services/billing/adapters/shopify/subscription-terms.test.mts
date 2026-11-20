import assert from "node:assert/strict";
import test from "node:test";
import { ShopifyBillingAdapter, toAppSubscriptionStatus } from "./shopify-billing-adapter.ts";

// Answers each query the adapter sends: billing currency, development-store check, then the mutation.
function adapter(billingCurrency: string, calls: Array<{ query: string; variables: Record<string, unknown> }>) {
  return new ShopifyBillingAdapter(async (query, variables) => {
    calls.push({ query, variables });
    if (query.includes("shopBillingPreferences")) return { shopBillingPreferences: { currency: billingCurrency } } as never;
    if (query.includes("partnerDevelopment")) return { shop: { plan: { partnerDevelopment: true } } } as never;
    return { appSubscriptionCreate: { appSubscription: { id: "gid://shopify/AppSubscription/1", status: "PENDING", lineItems: [{ id: "rec", plan: { pricingDetails: { __typename: "AppRecurringPricingDetails" } } }, { id: "use", plan: { pricingDetails: { __typename: "AppUsagePricingDetails" } } }] }, confirmationUrl: "https://admin.shopify.com/confirm", userErrors: [] } } as never;
  }, { info() {}, warn() {}, error() {} } as unknown as Console, async () => "shop-a.myshopify.com");
}
const input = { shopId: "shop-a", merchantSubscriptionId: "sub-a", planName: "Professional", returnUrl: "https://shop-a.myshopify.com/admin/apps/loopd2c/admin/billing", currency: "INR", monthlyBasePrice: "2899", usdMonthlyBasePrice: "29", cappedUsageAmount: "1000", usdCappedUsageAmount: "12", trialDays: 14, idempotencyKey: "k" };
function mutation(calls: Array<{ query: string; variables: Record<string, unknown> }>) {
  const call = calls.find((c) => c.query.includes("appSubscriptionCreate"));
  assert.ok(call, "subscription mutation sent");
  return call.variables as { lineItems: Array<{ plan: Record<string, { price?: { amount: string; currencyCode: string }; cappedAmount?: { amount: string; currencyCode: string } }> }>; trialDays: number | null; test: boolean };
}

test("an INR-billed store gets the rupee price, a ₹1000 usage cap and the 14-day trial", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const result = await adapter("INR", calls).createSubscription(input);
  assert.equal(result.usageLineItemId, "use");
  const sent = mutation(calls);
  assert.deepEqual(sent.lineItems[0].plan.appRecurringPricingDetails.price, { amount: "2899", currencyCode: "INR" });
  assert.deepEqual(sent.lineItems[1].plan.appUsagePricingDetails.cappedAmount, { amount: "1000", currencyCode: "INR" });
  assert.equal(sent.trialDays, 14);
  assert.equal(sent.test, true, "development stores get test charges");
});

test("a USD-billed store gets the dollar price with a dollar usage cap", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  await adapter("USD", calls).createSubscription(input);
  const sent = mutation(calls);
  assert.deepEqual(sent.lineItems[0].plan.appRecurringPricingDetails.price, { amount: "29", currencyCode: "USD" });
  assert.deepEqual(sent.lineItems[1].plan.appUsagePricingDetails.cappedAmount, { amount: "12", currencyCode: "USD" });
});

test("a USD-billed store without a dollar cap is refused instead of charging a rupee cap", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  await assert.rejects(adapter("USD", calls).createSubscription({ ...input, usdCappedUsageAmount: null }), /BILLING_CURRENCY_UNSUPPORTED|No USD price/);
});

test("subscription status exposes the usage line item, charge currency, cap and trial", () => {
  const status = toAppSubscriptionStatus({
    id: "gid://shopify/AppSubscription/1", status: "ACTIVE", trialDays: 14,
    lineItems: [
      { id: "gid://shopify/AppSubscriptionLineItem/1", plan: { pricingDetails: { __typename: "AppRecurringPricing", price: { currencyCode: "USD" } } } },
      { id: "gid://shopify/AppSubscriptionLineItem/2", plan: { pricingDetails: { __typename: "AppUsagePricing", cappedAmount: { amount: "12.0", currencyCode: "USD" } } } },
    ],
  });
  assert.deepEqual(status, { id: "gid://shopify/AppSubscription/1", status: "ACTIVE", trialDays: 14, recurringLineItemId: "gid://shopify/AppSubscriptionLineItem/1", usageLineItemId: "gid://shopify/AppSubscriptionLineItem/2", chargeCurrency: "USD", usageCap: { amount: "12.0", currency: "USD" } });
  assert.equal(toAppSubscriptionStatus({ id: "x", status: "ACTIVE" }).usageLineItemId, null);
});

test("the subscription status query uses Shopify's output pricing types", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./shopify-billing-adapter.ts", import.meta.url), "utf8");
  const query = source.slice(source.indexOf("const GET_SUBSCRIPTION"), source.indexOf("export function toAppSubscriptionStatus"));
  assert.match(query, /\.\.\. on AppRecurringPricing \{/);
  assert.match(query, /\.\.\. on AppUsagePricing \{/);
  assert.doesNotMatch(query, /PricingDetails \{/, "the ...PricingDetails names are input types and fail with undefinedType");
});
