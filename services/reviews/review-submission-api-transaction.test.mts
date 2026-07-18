import assert from "node:assert/strict";
import test from "node:test";
import { ReviewSubmissionDomainError, submitEligibleReviewWithTokenConsumption } from "./review-submission.ts";

function deps(options: { consumeCount?: number; failCreate?: boolean } = {}) {
  const state = { created: 0, consumed: 0 };
  const tx = {
    productReview: { create: async () => { state.created += 1; if (options.failCreate) throw new Error("create failed"); return { id: "review", shopifyProductId: "product", shopifyVariantId: null, shopifyOrderId: "order", shopifyLineItemId: "line", rating: 5, title: null, body: "Great", verifiedPurchase: true, status: "PENDING_MODERATION", source: "REVIEW_REQUEST_EMAIL", submittedAt: new Date("2026-07-18T12:00:00.000Z") }; } },
    reviewRequest: { updateMany: async () => { state.consumed += 1; return { count: options.consumeCount ?? 1 }; } },
  };
  const db = { ...tx, $transaction: async <T,>(fn: (client: typeof tx) => Promise<T>) => fn(tx) };
  return { state, dependencies: { db: db as never, eligibility: { getReviewSettings: async () => ({ reviewsEnabled: true }), findCustomer: async () => ({ id: "cust", shopId: "shop" }), findOrder: async () => ({ id: "order", shopId: "shop", customerProfileId: "cust", deliveredAt: new Date(), status: "DELIVERED" }), findOrderLine: async () => ({ id: "line", shopId: "shop", customerProfileId: "cust", megaskaOrderId: "order", shopifyOrderId: "order", shopifyLineItemId: "line", shopifyProductId: "product", shopifyVariantId: null }), findExistingReview: async () => null, isDelivered: () => true } } };
}
const command = { shopId: "shop", customerProfileId: "cust", source: "REVIEW_REQUEST_EMAIL" as const, reviewRequestId: "request", input: { rating: 5, body: "Great", productId: "product", orderId: "order", orderLineId: "line" } };

test("token submission creates review and consumes request atomically", async () => {
  const ctx = deps();
  const review = await submitEligibleReviewWithTokenConsumption(command, ctx.dependencies);
  assert.equal(review.id, "review");
  assert.deepEqual(ctx.state, { created: 1, consumed: 1 });
});

test("review create failure does not consume token", async () => {
  const ctx = deps({ failCreate: true });
  await assert.rejects(() => submitEligibleReviewWithTokenConsumption(command, ctx.dependencies), /create failed/);
  assert.deepEqual(ctx.state, { created: 1, consumed: 0 });
});

test("token consume failure reports consumed after create inside transaction", async () => {
  const ctx = deps({ consumeCount: 0 });
  await assert.rejects(() => submitEligibleReviewWithTokenConsumption(command, ctx.dependencies), ReviewSubmissionDomainError);
  assert.deepEqual(ctx.state, { created: 1, consumed: 1 });
});
