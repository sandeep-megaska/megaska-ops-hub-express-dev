import assert from "node:assert/strict";
import test from "node:test";
import { listEligibleReviewPurchases } from "./review-eligible-purchases.ts";

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
  return listEligibleReviewPurchases({ shopId: "shop-1", customerProfileId: "customer-1" }, { reviewRequest: { findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((item) => item.shopId === where.shopId && item.customerProfileId === where.customerProfileId && item.suppressedAt === null && item.canceledAt === null && item.review === null) } } as never);
}

test("returns delivered matching purchases, including a line refunded after delivery", async () => {
  const purchases = await list([row(), row({ id: "request-2", shopifyLineItemId: "line-refunded" })]);
  assert.deepEqual(purchases.map((purchase: { orderLineId: string }) => purchase.orderLineId), ["line-1", "line-refunded"]);
});

test("excludes existing reviews and suppressed or canceled requests", async () => {
  const purchases = await list([
    row({ id: "reviewed", review: { id: "review-1" } }),
    row({ id: "suppressed", suppressedAt: deliveredAt }),
    row({ id: "canceled", canceledAt: deliveredAt }),
  ]);
  assert.deepEqual(purchases, []);
});
