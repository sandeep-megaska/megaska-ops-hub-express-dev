import assert from "node:assert/strict";
import test from "node:test";
import { reviewSubmissionMessage } from "../../../../../services/reviews/review-submission-api.ts";

test("eligibility ineligible reasons use public-safe messages", () => {
  assert.equal(reviewSubmissionMessage("ALREADY_REVIEWED"), "A review has already been submitted for this item.");
  assert.equal(reviewSubmissionMessage("ORDER_NOT_OWNED"), "This item is not eligible for review.");
  assert.equal(reviewSubmissionMessage("ORDER_NOT_DELIVERED"), "This item is not eligible for review yet.");
});

test("review links through the storefront app proxy are not rejected for Shopify's own parameters", async () => {
  const { hasUnexpectedReviewQueryField: hasUnexpectedQueryField } = await import("../../../../../services/reviews/review-query-fields.ts");
  const proxied = new URLSearchParams({ accessToken: "a".repeat(43), shop: "store.myshopify.com", logged_in_customer_id: "", path_prefix: "/apps/loopd2c", timestamp: "1732200000" });
  assert.equal(hasUnexpectedQueryField(proxied), false);
  assert.equal(hasUnexpectedQueryField(new URLSearchParams({ entryPoint: "PRODUCT_PAGE", productId: "1", shop: "store.myshopify.com" })), false);
  assert.equal(hasUnexpectedQueryField(new URLSearchParams({ accessToken: "x", rating: "5" })), true, "other fields are still rejected");
});
