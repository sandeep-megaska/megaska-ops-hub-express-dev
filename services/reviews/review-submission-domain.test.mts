import assert from "node:assert/strict";
import test from "node:test";
import { createPendingReview, ReviewSubmissionDomainError, type SubmitReviewCommand } from "./review-submission.ts";

const command: SubmitReviewCommand = { shopId: "trusted-shop", customerProfileId: "trusted-customer", source: "PRODUCT_PAGE", reviewRequestId: "request", input: { rating: 5, title: " Nice ", body: " Works well ", productId: "product", variantId: null, orderId: "order", orderLineId: "line-1" } };

test("creates pending verified review from trusted identity and explicit Prisma payload", async () => {
  let data: Record<string, unknown> | undefined;
  const result = await createPendingReview(command, { now: () => new Date("2026-01-01T00:00:00.000Z"), db: { productReview: { create: async (args: { data: Record<string, unknown> }) => { data = args.data; return { id: "review", ...args.data }; } } } as never });
  assert.equal(data?.shopId, "trusted-shop");
  assert.equal(data?.customerProfileId, "trusted-customer");
  assert.equal(data?.source, "PRODUCT_PAGE");
  assert.equal(data?.verifiedPurchase, true);
  assert.equal(data?.status, "PENDING_MODERATION");
  assert.equal(data?.shopifyLineItemId, "line-1");
  assert.equal(data?.publishedAt, null);
  assert.equal("unsupported" in data!, false);
  assert.deepEqual(Object.keys(result).sort(), ["body", "id", "orderId", "orderLineId", "productId", "rating", "source", "status", "submittedAt", "title", "variantId", "verifiedPurchase"].sort());
  assert.equal((result as Record<string, unknown>).shopId, undefined);
  assert.equal((result as Record<string, unknown>).customerProfileId, undefined);
});

test("duplicate order-line review constraint maps to ALREADY_REVIEWED", async () => {
  await assert.rejects(() => createPendingReview(command, { db: { productReview: { create: async () => { throw { code: "P2002" }; } } } as never }), (error) => error instanceof ReviewSubmissionDomainError && error.code === "ALREADY_REVIEWED");
});

test("duplicate policy is scoped to customer, shop, and order line so another line can be reviewed", async () => {
  const lines: unknown[] = [];
  const db = { productReview: { create: async (args: { data: Record<string, unknown> }) => { lines.push(args.data.shopifyLineItemId); return { id: `review-${lines.length}`, ...args.data }; } } } as never;
  await createPendingReview(command, { db });
  await createPendingReview({ ...command, input: { ...command.input, orderLineId: "line-2" } }, { db });
  assert.deepEqual(lines, ["line-1", "line-2"]);
});
