import assert from "node:assert/strict";
import test from "node:test";
import { decideReviewEligibility } from "./review-eligibility.ts";

const protection = { requestDelayDays: 7, exchangeProtectionDays: 2, issueProtectionDays: 2, effectiveProtectionDays: 7, sources: { requestDelay: "REVIEW_SETTINGS" as const, exchangeProtection: "STORE_POLICY" as const, issueProtection: "STORE_POLICY" as const } };
const settings = { reviewsEnabled: true, cancellationBlocksReview: true, refundBlocksReview: true, exchangeBlocksReview: true, issueBlocksReview: true };
const order = { id: "o", shopId: "s", customerProfileId: "c", shopifyOrderName: "#1", deliveredAt: new Date("2026-01-01T00:00:00Z"), status: "DELIVERED" };
const request = { id: "r", shopId: "s", customerProfileId: "c", megaskaOrderId: "o", shopifyOrderId: "so", shopifyLineItemId: "li", shopifyProductId: "p", productTitleSnapshot: "Product", status: "PENDING_ELIGIBILITY" as const, blockReason: null, blockDetail: null, eligibleAt: null, deliveredAtSnapshot: null, completedAt: null, sentAt: null, tokenHash: null };
const decide = (extra: object = {}) => decideReviewEligibility({ request, order, customerExists: true, reviewExists: null, settings, actions: [], protection, now: new Date("2026-01-08T00:00:00Z"), ...extra });

test("uses canonical deliveredAt and becomes eligible exactly at the boundary", () => { const decision = decide(); assert.equal(decision.nextStatus, "ELIGIBLE"); assert.equal(decision.eligibleAt?.toISOString(), "2026-01-08T00:00:00.000Z"); });
test("keeps undelivered requests pending with diagnostic reason", () => { const decision = decide({ order: { ...order, deliveredAt: null } }); assert.equal(decision.nextStatus, "PENDING_ELIGIBILITY"); assert.equal(decision.blockReason, "ORDER_NOT_DELIVERED"); });
test("protection window remains pending before its fixed-day expiry", () => { const decision = decide({ now: new Date("2026-01-07T23:59:59Z") }); assert.equal(decision.nextStatus, "PENDING_ELIGIBILITY"); assert.equal(decision.blockReason, "PROTECTION_WINDOW"); });
test("reviews setting and action requests have deterministic blockers", () => { assert.equal(decide({ settings: { ...settings, reviewsEnabled: false } }).blockReason, "REVIEWS_DISABLED"); assert.equal(decide({ actions: [{ requestType: "ISSUE", status: "OPEN" }] }).blockReason, "ISSUE_REQUEST"); });
test("completed and sent states are never regressed", () => { assert.equal(decide({ request: { ...request, status: "COMPLETED" } }).nextStatus, "COMPLETED"); assert.equal(decide({ request: { ...request, status: "SENT" } }).nextStatus, "SENT"); });
test("existing reviews complete a line and cancelled/refunded orders block", () => { assert.equal(decide({ reviewExists: { submittedAt: new Date("2026-01-02T00:00:00Z") } }).nextStatus, "COMPLETED"); assert.equal(decide({ order: { ...order, status: "CANCELLED" } }).blockReason, "CANCELED_ORDER"); assert.equal(decide({ order: { ...order, status: "REFUNDED" } }).blockReason, "REFUNDED_ORDER"); });
