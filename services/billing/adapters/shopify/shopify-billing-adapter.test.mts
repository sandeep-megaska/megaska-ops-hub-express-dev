import assert from "node:assert/strict";
import test from "node:test";
import { ShopifyBillingAdapter, BillingProviderValidationError } from "./shopify-billing-adapter.ts";

function adapter(response: unknown, calls: Array<{ query: string; variables: Record<string, unknown>}) {
  return new ShopifyBillingAdapter(async (query, variables) => { calls.push({ query, variables }); return response as never; }, console, async () => "shop-a.myshopify.com");
}

test("creates recurring and configured usage line items from commercial plan values", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown>}> = [];
  const result = await adapter({ appSubscriptionCreate: { appSubscription: { id: "gid://shopify/AppSubscription/1", status: "PENDING", lineItems: [{ id: "rec", plan: { pricingDetails: { __typename: "AppRecurringPricingDetails" } } }, { id: "use", plan: { pricingDetails: { __typename: "AppUsagePricingDetails" } } }] }, confirmationUrl: "https://shopify.test/confirm", userErrors: [] } }, calls).createSubscription({ shopId: "shop-a", merchantSubscriptionId: "sub-a", planName: "Professional", returnUrl: "https://app.test/admin/billing/shopify/confirm?subscription=sub-a", currency: "inr", monthlyBasePrice: "4999.125", cappedUsageAmount: "9000.50", idempotencyKey: "shopify:subscription:sub-a:1" });
  assert.equal(result.recurringLineItemId, "rec"); assert.equal(result.usageLineItemId, "use");
  const lines = calls[0].variables.lineItems as Array<{ plan: Record<string, unknown> }>;
  assert.equal((lines[0].plan.appRecurringPricingDetails as { price: { amount: string; currencyCode: string } }).price.amount, "4999.125");
  assert.equal((lines[1].plan.appUsagePricingDetails as { cappedAmount: { currencyCode: string } }).cappedAmount.currencyCode, "INR");
});

test("skips zero rated usage and preserves precise decimal amounts", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown>}> = [];
  const zero = await adapter({}, calls).createUsageCharge({ shopId: "shop-a", merchantSubscriptionId: "sub-a", merchantBillingPeriodId: "period-a", merchantRatedUsageId: "rated-a", description: "OTP", currency: "INR", amount: "0.000000", usageLineItemId: "line", idempotencyKey: "shopify:usage:rated-a" });
  assert.equal(zero.status, "SKIPPED_ZERO_AMOUNT"); assert.equal(calls.length, 0);
  await adapter({ appUsageRecordCreate: { appUsageRecord: { id: "gid://shopify/AppUsageRecord/1" }, userErrors: [] } }, calls).createUsageCharge({ shopId: "shop-a", merchantSubscriptionId: "sub-a", merchantBillingPeriodId: "period-a", description: "OTP", currency: "INR", amount: "0.123456", usageLineItemId: "line", idempotencyKey: "shopify:usage:rated-a" });
  assert.equal(((calls[0].variables.price as { amount: string }).amount), "0.123456");
});

test("rejects negative money and normalizes Shopify user errors as final", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown>}> = [];
  await assert.rejects(() => adapter({}, calls).createUsageCharge({ shopId: "shop-a", merchantSubscriptionId: "sub-a", merchantBillingPeriodId: "period-a", description: "OTP", currency: "INR", amount: "-1", usageLineItemId: "line", idempotencyKey: "x" }), BillingProviderValidationError);
  await assert.rejects(() => adapter({ appUsageRecordCreate: { appUsageRecord: null, userErrors: [{ code: "CAPPED_AMOUNT_EXCEEDED", message: "cap" }] } }, calls).createUsageCharge({ shopId: "shop-a", merchantSubscriptionId: "sub-a", merchantBillingPeriodId: "period-a", description: "OTP", currency: "INR", amount: "1", usageLineItemId: "line", idempotencyKey: "x" }), (error: Error & { retryable?: boolean }) => error.retryable === false);
});
