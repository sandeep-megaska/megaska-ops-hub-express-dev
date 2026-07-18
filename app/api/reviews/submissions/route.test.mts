import assert from "node:assert/strict";
import test from "node:test";
import { reviewSubmissionErrorStatus, validateSubmissionEnvelope } from "../../../../services/reviews/review-submission-api.ts";

test("submission envelope rejects unknown and trusted fields", () => {
  assert.equal(validateSubmissionEnvelope({ rating: 5, body: "Great", productId: "p", orderId: "o", orderLineId: "l", entryPoint: "PRODUCT_PAGE", shopId: "shop" }).ok, false);
  assert.equal(validateSubmissionEnvelope({ rating: 5, body: "Great", productId: "p", orderId: "o", orderLineId: "l", entryPoint: "PRODUCT_PAGE", verifiedPurchase: true }).ok, false);
  assert.equal(validateSubmissionEnvelope({ rating: 5, body: "Great", productId: "p", orderId: "o", orderLineId: "l", entryPoint: "PRODUCT_PAGE", source: "MERCHANT_CREATED" }).ok, false);
  assert.equal(validateSubmissionEnvelope({ rating: 5, body: "Great", productId: "p", orderId: "o", orderLineId: "l", entryPoint: "PRODUCT_PAGE", status: "PUBLISHED" }).ok, false);
});

test("submission envelope requires constrained session entry point unless token is supplied", () => {
  assert.deepEqual(validateSubmissionEnvelope({ rating: 5, body: "Great", productId: "p", orderId: "o", orderLineId: "l", entryPoint: "PRODUCT_PAGE" }), { ok: true, accessToken: null, entryPoint: "PRODUCT_PAGE" });
  assert.deepEqual(validateSubmissionEnvelope({ rating: 5, body: "Great", productId: "p", orderId: "o", orderLineId: "l", accessToken: " token " }), { ok: true, accessToken: "token", entryPoint: null });
  assert.equal(validateSubmissionEnvelope({ rating: 5, body: "Great", productId: "p", orderId: "o", orderLineId: "l" }).ok, false);
  assert.equal(validateSubmissionEnvelope({ rating: 5, body: "Great", productId: "p", orderId: "o", orderLineId: "l", entryPoint: "ADMIN" }).ok, false);
});

test("domain errors map to stable customer-safe statuses", () => {
  assert.equal(reviewSubmissionErrorStatus("INVALID_INPUT"), 400);
  assert.equal(reviewSubmissionErrorStatus("INVALID_TOKEN"), 401);
  assert.equal(reviewSubmissionErrorStatus("TOKEN_CONSUMED"), 409);
  assert.equal(reviewSubmissionErrorStatus("REVIEWS_DISABLED"), 403);
  assert.equal(reviewSubmissionErrorStatus("ORDER_NOT_DELIVERED"), 409);
  assert.equal(reviewSubmissionErrorStatus("ORDER_LINE_NOT_FOUND"), 404);
});
