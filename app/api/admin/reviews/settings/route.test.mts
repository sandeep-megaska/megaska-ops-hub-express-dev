import test from "node:test";
import assert from "node:assert/strict";
import { parseDisplaySettingsInput } from "../../../../../services/reviews/review-display-settings-input.ts";

const valid = { storefrontReviewsEnabled: true, showReviewSummary: true, showRatingDistribution: true, showVerifiedPurchaseBadge: true, showReviewDates: true, showVariantTitle: true, reviewsPerPage: 10, defaultReviewSort: "NEWEST" };

test("settings API parser rejects unsupported sort values", () => {
  assert.equal(parseDisplaySettingsInput(valid).defaultReviewSort, "NEWEST");
  assert.throws(() => parseDisplaySettingsInput({ ...valid, defaultReviewSort: "legacy" }), /defaultReviewSort is invalid/);
});
