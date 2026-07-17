import test from "node:test";
import assert from "node:assert/strict";
import { storefrontReviewsAvailable } from "./route.ts";

test("storefront review display depends only on storefrontReviewsEnabled", () => {
  assert.equal(storefrontReviewsAvailable({ reviewsEnabled: false, storefrontReviewsEnabled: false }), false);
  assert.equal(storefrontReviewsAvailable({ reviewsEnabled: false, storefrontReviewsEnabled: true }), true);
  assert.equal(storefrontReviewsAvailable({ reviewsEnabled: true, storefrontReviewsEnabled: false }), false);
  assert.equal(storefrontReviewsAvailable({ reviewsEnabled: true, storefrontReviewsEnabled: true }), true);
});
