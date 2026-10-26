import assert from "node:assert/strict";
import test from "node:test";

import { evaluateExchangeEligibility } from "./eligibility.ts";
import {
  evaluateIssueEligibility,
  ISSUE_VIDEO_INVALID_MESSAGE,
  ISSUE_VIDEO_REQUIRED_MESSAGE,
  validateIssueVideoEvidence,
} from "./issue.ts";
import { EXCHANGE_ALLOWED_DAYS_WINDOW } from "./constants.ts";
import { EXCHANGE_REQUEST_WINDOW_MESSAGE, ISSUE_REPORT_WINDOW_MESSAGE } from "./deadlines.ts";

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const BASE_EXCHANGE = {
  requestedSize: "L",
  currentSize: "M",
  productTitle: "Modest Swimdress",
  variantTitle: "Navy",
  reason: "Size too small",
  fulfillmentStatus: "delivered",
};

test("default exchange window is 5 days", () => {
  assert.equal(EXCHANGE_ALLOWED_DAYS_WINDOW, 5);
});

test("exchange: within the default window is eligible, beyond it is rejected", () => {
  assert.equal(
    evaluateExchangeEligibility({ ...BASE_EXCHANGE, deliveredAt: daysAgoIso(4) }).decision,
    "ELIGIBLE",
  );
  const late = evaluateExchangeEligibility({ ...BASE_EXCHANGE, deliveredAt: daysAgoIso(6) });
  assert.equal(late.decision, "REJECTED");
  assert.equal(late.reason, EXCHANGE_REQUEST_WINDOW_MESSAGE);
  assert.match(late.reason, /within 2 days of delivery/);
});

test("exchange: a custom windowDays overrides the default; the message always quotes the published 2 days", () => {
  // window 3: delivered 4 days ago → rejected, message still quotes 2 days
  const rejected = evaluateExchangeEligibility({
    ...BASE_EXCHANGE,
    deliveredAt: daysAgoIso(4),
    windowDays: 3,
  });
  assert.equal(rejected.decision, "REJECTED");
  assert.equal(rejected.reason, EXCHANGE_REQUEST_WINDOW_MESSAGE);
  // window 3: delivered 2 days ago → eligible
  assert.equal(
    evaluateExchangeEligibility({ ...BASE_EXCHANGE, deliveredAt: daysAgoIso(2), windowDays: 3 }).decision,
    "ELIGIBLE",
  );
});

test("exchange: excludedCategories override the built-in hygiene list", () => {
  const bikini = { ...BASE_EXCHANGE, productTitle: "High Waisted Bikini Set", deliveredAt: daysAgoIso(1) };
  // Default list excludes "bikini".
  const blocked = evaluateExchangeEligibility(bikini);
  assert.equal(blocked.decision, "REJECTED");
  assert.match(blocked.reason, /excluded from exchange/);
  // An explicit empty list allows everything.
  assert.equal(
    evaluateExchangeEligibility({ ...bikini, excludedCategories: [] }).decision,
    "ELIGIBLE",
  );
  // A custom list blocks a keyword that the default never would.
  assert.equal(
    evaluateExchangeEligibility({
      ...BASE_EXCHANGE,
      productTitle: "Cotton Summer Dress",
      deliveredAt: daysAgoIso(1),
      excludedCategories: ["dress"],
    }).decision,
    "REJECTED",
  );
});

const BASE_ISSUE = {
  fulfillmentStatus: "delivered",
  declaredUnused: true,
  declaredUnwashed: true,
  declaredTagsIntact: true,
};

test("issue: enforces the configurable window (default 5, custom overrides) but always quotes the published 2 days", () => {
  assert.equal(
    evaluateIssueEligibility({ ...BASE_ISSUE, deliveredAt: daysAgoIso(4) }).eligible,
    true,
  );
  const late = evaluateIssueEligibility({ ...BASE_ISSUE, deliveredAt: daysAgoIso(6) });
  assert.equal(late.eligible, false);
  assert.equal(late.reason, ISSUE_REPORT_WINDOW_MESSAGE);
  assert.match(late.reason, /within 2 days of delivery/);

  const customLate = evaluateIssueEligibility({ ...BASE_ISSUE, deliveredAt: daysAgoIso(4), windowDays: 3 });
  assert.equal(customLate.eligible, false);
  assert.equal(customLate.reason, ISSUE_REPORT_WINDOW_MESSAGE);
});

test("issue: an unboxing video link is required and must be http(s)", () => {
  assert.equal(validateIssueVideoEvidence([]), ISSUE_VIDEO_REQUIRED_MESSAGE);
  assert.equal(validateIssueVideoEvidence(["not a link"]), ISSUE_VIDEO_INVALID_MESSAGE);
  assert.equal(validateIssueVideoEvidence(["https://drive.google.com/file/d/abc", "javascript:alert(1)"]), ISSUE_VIDEO_INVALID_MESSAGE);
  assert.equal(validateIssueVideoEvidence(["https://youtu.be/abc"]), null);
  assert.equal(validateIssueVideoEvidence(["http://example.com/video.mp4", "https://drive.google.com/file/d/abc"]), null);
});
