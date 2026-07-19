import assert from "node:assert/strict";
import test from "node:test";
import { ReviewSubmissionDomainError, submitEligibleReviewWithTokenConsumption } from "./review-submission.ts";

function deps(options: { consumeCount?: number; failCreate?: boolean; throwNotification?: boolean } = {}) {
  const state = { created: 0, consumed: 0, committed: false, notified: 0 };
  const tx = {
    productReview: { create: async () => { state.created += 1; if (options.failCreate) throw new Error("create failed"); return { id: "review", shopId: "shop", shopifyProductId: "product", shopifyVariantId: null, shopifyOrderId: "order", shopifyLineItemId: "line", rating: 5, title: null, body: "Great", customerDisplayName: "Customer", verifiedPurchase: true, productTitleSnapshot: "Product", variantTitleSnapshot: null, status: "PENDING_MODERATION", source: "REVIEW_REQUEST_EMAIL", submittedAt: new Date("2026-07-18T12:00:00.000Z") }; } },
    reviewRequest: { updateMany: async () => { state.consumed += 1; return { count: options.consumeCount ?? 1 }; } },
  };
  const db = { ...tx, $transaction: async <T,>(fn: (client: typeof tx) => Promise<T>) => { const result = await fn(tx); state.committed = true; return result; } };
  return { state, dependencies: { db: db as never, notifyAdmin: async () => { assert.equal(state.committed, true); state.notified += 1; if (options.throwNotification) throw new Error("notification failed"); }, eligibility: { getReviewSettings: async () => ({ reviewsEnabled: true }), findCustomer: async () => ({ id: "cust", shopId: "shop" }), findOrder: async () => ({ id: "order", shopId: "shop", customerProfileId: "cust", shopifyOrderName: "#1001", deliveredAt: new Date(), status: "DELIVERED" }), findOrderLine: async () => ({ id: "line", shopId: "shop", customerProfileId: "cust", megaskaOrderId: "order", shopifyOrderId: "order", shopifyLineItemId: "line", shopifyProductId: "product", shopifyVariantId: null, productTitleSnapshot: "Product", variantTitleSnapshot: null }), findExistingReview: async () => null, isDelivered: () => true } } };
}
const command = { shopId: "shop", customerProfileId: "cust", source: "REVIEW_REQUEST_EMAIL" as const, reviewRequestId: "request", input: { rating: 5, body: "Great", productId: "product", orderId: "order", orderLineId: "line" } };

test("token submission creates review and consumes request atomically", async () => {
  const ctx = deps();
  const review = await submitEligibleReviewWithTokenConsumption(command, ctx.dependencies);
  assert.equal(review.id, "review");
  assert.deepEqual(ctx.state, { created: 1, consumed: 1, committed: true, notified: 1 });
});

test("review create failure does not consume token", async () => {
  const ctx = deps({ failCreate: true });
  await assert.rejects(() => submitEligibleReviewWithTokenConsumption(command, ctx.dependencies), /create failed/);
  assert.deepEqual(ctx.state, { created: 1, consumed: 0, committed: false, notified: 0 });
});

test("token consume failure reports consumed after create inside transaction", async () => {
  const ctx = deps({ consumeCount: 0 });
  await assert.rejects(() => submitEligibleReviewWithTokenConsumption(command, ctx.dependencies), ReviewSubmissionDomainError);
  assert.deepEqual(ctx.state, { created: 1, consumed: 1, committed: false, notified: 0 });
});

test("unexpected post-commit notification failure does not fail submission", async () => {
  const ctx = deps({ throwNotification: true });
  const review = await submitEligibleReviewWithTokenConsumption(command, ctx.dependencies);
  assert.equal(review.id, "review");
  assert.deepEqual(ctx.state, { created: 1, consumed: 1, committed: true, notified: 1 });
});
