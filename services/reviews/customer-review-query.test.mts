import assert from "node:assert/strict";
import test from "node:test";
import { customerReviewPage, listCustomerReviews } from "./customer-review-query.ts";

test("customer review pagination is bounded", () => {
  assert.deepEqual(customerReviewPage({ page: -2, pageSize: 500 }), { page: 1, pageSize: 50, skip: 0 });
  assert.deepEqual(customerReviewPage({ page: 3, pageSize: 10 }), { page: 3, pageSize: 10, skip: 20 });
});

test("query scopes reviews and eligible lines and exposes only the customer projection", async () => {
  const calls: unknown[] = [];
  const db = {
    reviewSettings: { findUnique: async () => ({ reviewsEnabled: true }) },
    productReview: {
      count: async (args: unknown) => { calls.push(args); return 1; },
      findMany: async (args: unknown) => { calls.push(args); return [{ id: "r1", shopifyProductId: "p", shopifyVariantId: null, productTitleSnapshot: "Boot", variantTitleSnapshot: null, rating: 5, title: "Great", body: "Very good", verifiedPurchase: true, status: "PENDING_MODERATION", submittedAt: new Date("2026-07-18"), publishedAt: null, reviewRequest: { productImageUrlSnapshot: "https://cdn/image", shopifyOrderName: "#1" }, megaskaOrder: null, moderationNote: "secret" }]; },
    },
    reviewRequest: { findMany: async (args: unknown) => { calls.push(args); return [{ megaskaOrderId: "o", shopifyLineItemId: "l", shopifyProductId: "p", shopifyVariantId: null, productTitleSnapshot: "Boot", variantTitleSnapshot: null, productImageUrlSnapshot: null, shopifyOrderName: "#1", deliveredAtSnapshot: new Date("2026-07-17"), megaskaOrder: { id: "o", shopId: "shop", customerProfileId: "customer", shopifyOrderName: "#1", deliveredAt: new Date("2026-07-17"), status: "DELIVERED" } }]; } },
  };
  const result = await listCustomerReviews({ shopId: "shop", customerProfileId: "customer" }, db as never);
  assert.equal(result.reviews.length, 1); assert.equal(result.awaitingReviews.length, 1);
  assert.equal("moderationNote" in result.reviews[0], false);
  assert.match(JSON.stringify(calls), /"shopId":"shop","customerProfileId":"customer"/);
  for (const forbidden of ["reviewRequestId", "tokenHash", "moderationNote"]) assert.equal(JSON.stringify(result).includes(forbidden), false);
});
