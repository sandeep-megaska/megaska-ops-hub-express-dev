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

import { DEFAULT_REVIEW_SETTINGS } from "../../../../../services/reviews/review-settings.ts";
import { publicSettings } from "./route.ts";

test("settings API response projects only merchant-writable display fields", () => {
  const response = publicSettings({
    shopId: "shop-1",
    ...DEFAULT_REVIEW_SETTINGS,
    id: "settings-id",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  assert.equal(response.reviewsEnabled, false);
  assert.equal("shopId" in response, false);
  assert.equal("id" in response, false);
  assert.equal("createdAt" in response, false);
  assert.equal("updatedAt" in response, false);
});
