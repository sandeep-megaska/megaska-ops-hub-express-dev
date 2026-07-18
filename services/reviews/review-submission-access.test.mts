import assert from "node:assert/strict";
import test from "node:test";
import { createReviewRequestToken } from "./review-request-token.ts";
import { resolveCanonicalReviewTarget, resolveReviewAccessFromRequestToken, resolveReviewSubmissionAccess } from "./review-submission-access.ts";

const now = new Date("2026-07-18T00:00:00.000Z");
const generated = createReviewRequestToken({ now });
function request(overrides: Record<string, unknown> = {}) {
  return {
    id: "rr", shopId: "shop", customerProfileId: "cust", megaskaOrderId: "order", shopifyLineItemId: "line", shopifyProductId: "product", shopifyVariantId: "variant",
    status: "SENT", tokenExpiresAt: new Date("2026-08-01T00:00:00.000Z"), tokenRevokedAt: null, tokenConsumedAt: null, submittedReviewId: null, suppressedAt: null, completedAt: null, canceledAt: null,
    shop: { id: "shop" }, customerProfile: { id: "cust", shopId: "shop" }, deliveryAttempts: [{ channel: "EMAIL" }], ...overrides,
  };
}
function db(row: unknown = request(), settings: unknown = { reviewsEnabled: true }) {
  return { reviewRequest: { findUnique: async () => row }, reviewSettings: { findUnique: async () => settings } } as never;
}
function reason(result: Awaited<ReturnType<typeof resolveReviewAccessFromRequestToken>>) { assert.equal(result.ok, false); return result.reason; }

test("valid token resolves canonical trusted database identifiers", async () => {
  const access = await resolveReviewAccessFromRequestToken({ token: generated.token, now, db: db() });
  assert.deepEqual(access, { ok: true, mode: "REVIEW_REQUEST_TOKEN", shopId: "shop", customerProfileId: "cust", source: "REVIEW_REQUEST_EMAIL", reviewRequestId: "rr", orderId: "order", orderLineId: "line", productId: "product", variantId: "variant" });
});

test("token failures do not reveal or fall back", async () => {
  assert.equal(reason(await resolveReviewAccessFromRequestToken({ token: "bad", now, db: db() })), "INVALID_TOKEN");
  assert.equal(reason(await resolveReviewAccessFromRequestToken({ token: generated.token, now, db: db(null) })), "INVALID_TOKEN");
  assert.equal(reason(await resolveReviewAccessFromRequestToken({ token: generated.token, now, db: db(request({ tokenExpiresAt: now })) })), "EXPIRED_TOKEN");
  assert.equal(reason(await resolveReviewAccessFromRequestToken({ token: generated.token, now, db: db(request({ tokenRevokedAt: now })) })), "TOKEN_REVOKED");
  assert.equal(reason(await resolveReviewAccessFromRequestToken({ token: generated.token, now, db: db(request({ tokenConsumedAt: now })) })), "TOKEN_CONSUMED");
  assert.equal(reason(await resolveReviewAccessFromRequestToken({ token: generated.token, shopId: "other", now, db: db() })), "TENANT_MISMATCH");
  assert.equal(reason(await resolveReviewAccessFromRequestToken({ token: generated.token, now, db: db(request({ status: "COMPLETED" })) })), "REQUEST_NOT_ELIGIBLE");
  assert.equal(reason(await resolveReviewAccessFromRequestToken({ token: generated.token, now, db: db(request(), { reviewsEnabled: false }) })), "REQUEST_NOT_ELIGIBLE");
});

test("automaticRequestsEnabled false does not invalidate already issued token", async () => {
  const access = await resolveReviewAccessFromRequestToken({ token: generated.token, now, db: db(request(), { reviewsEnabled: true, automaticRequestsEnabled: false }) });
  assert.equal(access.ok, true);
});

test("combined resolver prefers supplied token and does not fall back after invalid token", async () => {
  const withToken = await resolveReviewSubmissionAccess({ request: {} as never, accessToken: generated.token, now, db: db() });
  assert.equal(withToken.ok && withToken.mode, "REVIEW_REQUEST_TOKEN");
  const invalid = await resolveReviewSubmissionAccess({ request: {} as never, accessToken: "invalid", now, db: db() });
  assert.deepEqual(invalid, { ok: false, reason: "INVALID_TOKEN" });
});

test("token source is derived from delivery channel and target conflicts are rejected", async () => {
  const access = await resolveReviewAccessFromRequestToken({ token: generated.token, now, db: db(request({ deliveryAttempts: [{ channel: "WHATSAPP" }] })) });
  assert.equal(access.ok && access.source, "REVIEW_REQUEST_WHATSAPP");
  assert.deepEqual(resolveCanonicalReviewTarget(access, { orderId: "order", orderLineId: "line", productId: "product", variantId: "variant" }), { ok: true, orderId: "order", orderLineId: "line", productId: "product", variantId: "variant" });
  assert.deepEqual(resolveCanonicalReviewTarget(access, { productId: "other" }), { ok: false, reason: "REQUEST_TARGET_MISMATCH" });
});
