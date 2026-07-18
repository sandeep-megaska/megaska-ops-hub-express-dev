import assert from "node:assert/strict";
import test from "node:test";
import { validateReviewSubmissionInput, ReviewSubmissionInputError } from "./review-submission-input.ts";

const valid = { rating: 5, title: " Good ", body: " Helpful review ", productId: " p ", variantId: " v ", orderId: " o ", orderLineId: " l " };
function fails(input: unknown, field: string) { assert.throws(() => validateReviewSubmissionInput(input), (error) => error instanceof ReviewSubmissionInputError && field in error.fieldErrors); }

test("review submission input accepts only plain customer review fields", () => {
  assert.equal(validateReviewSubmissionInput({ ...valid, rating: 1 }).rating, 1);
  assert.equal(validateReviewSubmissionInput({ ...valid, rating: 5 }).rating, 5);
  assert.equal(validateReviewSubmissionInput(valid).title, "Good");
  assert.equal(validateReviewSubmissionInput({ ...valid, title: "   " }).title, null);
  assert.equal(validateReviewSubmissionInput(valid).body, "Helpful review");
  assert.equal(validateReviewSubmissionInput(valid).productId, "p");
  for (const field of ["shopId", "customerProfileId", "verifiedPurchase", "status"]) fails({ ...valid, [field]: "x" }, field);
});

test("review submission input rejects invalid ratings, text, ids, and unknown fields", () => {
  fails({ ...valid, rating: 0 }, "rating");
  fails({ ...valid, rating: 6 }, "rating");
  fails({ ...valid, rating: 1.5 }, "rating");
  fails({ ...valid, title: "x".repeat(121) }, "title");
  fails({ ...valid, body: "abcd" }, "body");
  fails({ ...valid, body: "x".repeat(5001) }, "body");
  fails({ ...valid, productId: " " }, "productId");
  fails({ ...valid, orderId: " " }, "orderId");
  fails({ ...valid, orderLineId: " " }, "orderLineId");
  fails({ ...valid, extra: true }, "extra");
});
