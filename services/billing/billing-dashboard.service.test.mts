import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __setBillingDashboardPrismaForTests, getBillingProviderStatus } from "./billing-dashboard.service.ts";

const row = {
  billingProvider: "SHOPIFY", providerStatus: "PENDING_CONFIRMATION", confirmationUrl: "https://admin.shopify.com/confirm", providerActivatedAt: null,
  updatedAt: new Date("2026-07-16T00:00:00.000Z"), billingProviderSubmissions: [{ status: "FAILED_RETRYABLE", errorCode: "SHOPIFY_TRANSPORT_RETRYABLE", errorMessage: "internal upstream detail", updatedAt: new Date("2026-07-15T00:00:00.000Z") }],
};

beforeEach(() => __setBillingDashboardPrismaForTests({ merchantSubscription: { async findFirst(args: unknown) {
  const where = (args as { where: { shopId: string } }).where;
  return where.shopId === "shop-a" ? row : null;
} } }));

test("provider dashboard status is tenant scoped and excludes provider snapshots", async () => {
  const provider = await getBillingProviderStatus({ shopId: "shop-a" });
  assert.deepEqual(provider, {
    provider: "SHOPIFY", status: "PENDING_CONFIRMATION", confirmationRequired: true, confirmationUrl: "https://admin.shopify.com/confirm",
    lastUpdatedAt: "2026-07-15T00:00:00.000Z", errorCode: "SHOPIFY_TRANSPORT_RETRYABLE", errorMessage: "Shopify billing is temporarily unavailable.",
  });
  assert.equal(await getBillingProviderStatus({ shopId: "shop-b" }), null);
  assert.equal(JSON.stringify(provider).includes("internal upstream detail"), false);
});
