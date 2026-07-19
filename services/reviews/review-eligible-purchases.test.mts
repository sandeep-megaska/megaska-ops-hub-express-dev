import assert from "node:assert/strict";
import test from "node:test";
import { listEligibleReviewPurchases, listEligibleReviewPurchasesWithDiagnostics } from "./review-eligible-purchases.ts";

const deliveredAt = new Date("2026-07-18T10:00:00Z");
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "request-1", shopId: "shop-1", customerProfileId: "customer-1", megaskaOrderId: "order-1",
  shopifyOrderName: "#123", shopifyLineItemId: "line-1", shopifyProductId: "product-1", shopifyVariantId: "variant-1",
  productTitleSnapshot: "Tea", variantTitleSnapshot: "Large", productImageUrlSnapshot: null, deliveredAtSnapshot: deliveredAt,
  createdAt: deliveredAt, suppressedAt: null, canceledAt: null, review: null,
  megaskaOrder: { id: "order-1", shopId: "shop-1", customerProfileId: "customer-1", shopifyOrderName: "#123", deliveredAt, status: "DELIVERED" },
  ...overrides,
});

async function list(rows: ReturnType<typeof row>[]) {
  return listEligibleReviewPurchases({ shopId: "shop-1", customerProfileId: "customer-1" }, db(rows));
}

function db(rows: ReturnType<typeof row>[]) {
  type TestWhere = { shopId?: unknown; customerProfileId?: unknown; shopifyProductId?: { in: string[] } };
  const matching = (where: TestWhere) => rows.filter((item) => item.shopId === where.shopId && (!where.customerProfileId || item.customerProfileId === where.customerProfileId) && (!where.shopifyProductId || where.shopifyProductId.in.includes(item.shopifyProductId as string)) && item.suppressedAt === null && item.canceledAt === null && item.review === null);
  return { reviewRequest: { count: async ({ where }: { where: Record<string, unknown> }) => matching(where).length, findMany: async ({ where }: { where: Record<string, unknown> }) => matching(where) } } as never;
}

test("returns delivered matching purchases, including a line refunded after delivery", async () => {
  const purchases = await list([row(), row({ id: "request-2", shopifyLineItemId: "line-refunded" })]);
  assert.deepEqual(purchases.map((purchase: { orderLineId: string }) => purchase.orderLineId), ["line-1", "line-refunded"]);
});

test("numeric request matches a stored Shopify product GID", async () => {
  const purchases = await listEligibleReviewPurchases(
    { shopId: "shop-1", customerProfileId: "customer-1", productId: "10092273140010" },
    db([row({ shopifyProductId: "gid://shopify/Product/10092273140010" })]),
  );
  assert.equal(purchases.length, 1);
});

test("GID request matches a stored numeric Shopify product ID", async () => {
  const purchases = await listEligibleReviewPurchases(
    { shopId: "shop-1", customerProfileId: "customer-1", productId: "gid://shopify/Product/10092273140010" },
    db([row({ shopifyProductId: "10092273140010" })]),
  );
  assert.equal(purchases.length, 1);
});

test("numeric request matches a stored numeric Shopify product ID", async () => {
  const purchases = await listEligibleReviewPurchases(
    { shopId: "shop-1", customerProfileId: "customer-1", productId: "10092273140010" },
    db([row({ shopifyProductId: "10092273140010" })]),
  );
  assert.equal(purchases.length, 1);
});

test("unrelated products do not match either product ID representation", async () => {
  const purchases = await listEligibleReviewPurchases(
    { shopId: "shop-1", customerProfileId: "customer-1", productId: "10092273140010" },
    db([row({ shopifyProductId: "gid://shopify/Product/999" })]),
  );
  assert.deepEqual(purchases, []);
});

test("matching products from another shop remain excluded", async () => {
  const purchases = await listEligibleReviewPurchases(
    { shopId: "shop-1", customerProfileId: "customer-1", productId: "10092273140010" },
    db([row({ shopId: "shop-2", shopifyProductId: "gid://shopify/Product/10092273140010" })]),
  );
  assert.deepEqual(purchases, []);
});

test("excludes existing reviews and suppressed or canceled requests", async () => {
  const purchases = await list([
    row({ id: "reviewed", review: { id: "review-1" } }),
    row({ id: "suppressed", suppressedAt: deliveredAt }),
    row({ id: "canceled", canceledAt: deliveredAt }),
  ]);
  assert.deepEqual(purchases, []);
});

test("diagnostics prove a session profile mismatch without broadening customer access", async () => {
  const result = await listEligibleReviewPurchasesWithDiagnostics(
    { shopId: "shop-1", customerProfileId: "otp-profile", productId: "10092273140010" },
    db([row({ customerProfileId: "shopify-import-profile", shopifyProductId: "10092273140010" })]),
  );

  assert.deepEqual(result.purchases, []);
  assert.deepEqual(result.diagnostics, {
    reviewRequestCountBeforeCustomerProfileFilter: 1,
    reviewRequestCountAfterCustomerProfileFilter: 0,
    finalCountAfterCanonicalDeliveryChecks: 0,
  });
});
