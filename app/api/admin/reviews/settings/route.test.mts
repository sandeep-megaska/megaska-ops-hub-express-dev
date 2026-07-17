import test from "node:test";
import assert from "node:assert/strict";
import { parseDisplaySettingsInput } from "../../../../../services/reviews/review-display-settings-input.ts";

const valid = { reviewsEnabled: true, automaticRequestsEnabled: true, storefrontReviewsEnabled: true, showReviewSummary: true, showRatingDistribution: true, showVerifiedPurchaseBadge: true, showReviewDates: true, showVariantTitle: true, reviewsPerPage: 10, defaultReviewSort: "NEWEST" };

test("settings API parser rejects unsupported sort values", () => {
  assert.equal(parseDisplaySettingsInput(valid).defaultReviewSort, "NEWEST");
  assert.throws(() => parseDisplaySettingsInput({ ...valid, defaultReviewSort: "legacy" }), /defaultReviewSort is invalid/);
});

test("settings API parser accepts activation booleans and rejects malformed or unsupported input", () => {
  assert.equal(parseDisplaySettingsInput({ ...valid, reviewsEnabled: false }).reviewsEnabled, false);
  assert.equal(parseDisplaySettingsInput({ ...valid, automaticRequestsEnabled: false }).automaticRequestsEnabled, false);
  assert.equal(parseDisplaySettingsInput({ ...valid, storefrontReviewsEnabled: false }).storefrontReviewsEnabled, false);
  assert.throws(() => parseDisplaySettingsInput({ ...valid, reviewsEnabled: "true" }), /reviewsEnabled must be boolean/);
  assert.throws(() => parseDisplaySettingsInput({ ...valid, automaticRequestsEnabled: 1 }), /automaticRequestsEnabled must be boolean/);
  assert.throws(() => parseDisplaySettingsInput({ ...valid, shopId: "other-shop" }), /shopId is not supported/);
  assert.throws(() => parseDisplaySettingsInput({ ...valid, reviewsPerPage: 26 }), /reviewsPerPage must be an integer/);
});
