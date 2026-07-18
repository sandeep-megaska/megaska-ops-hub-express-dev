import assert from "node:assert/strict";
import test from "node:test";
import { reviewSubmissionMessage } from "../../../../../services/reviews/review-submission-api.ts";

test("eligibility ineligible reasons use public-safe messages", () => {
  assert.equal(reviewSubmissionMessage("ALREADY_REVIEWED"), "A review has already been submitted for this item.");
  assert.equal(reviewSubmissionMessage("ORDER_NOT_OWNED"), "This item is not eligible for review.");
  assert.equal(reviewSubmissionMessage("ORDER_NOT_DELIVERED"), "This item is not eligible for review yet.");
});
