import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewSubmissionUrl, consumeReviewRequestToken, createReviewRequestToken, hashReviewRequestToken, issueReviewRequestToken, normalizeReviewRequestToken } from "./review-request-token.ts";

const now = new Date("2026-07-18T00:00:00.000Z");

test("creates URL-safe random token with SHA-256 hash and default expiry", () => {
  const first = createReviewRequestToken({ now });
  const second = createReviewRequestToken({ now });
  assert.match(first.token, /^[A-Za-z0-9_-]{43,200}$/);
  assert.equal(first.token.length, 43);
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashReviewRequestToken(first.token));
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(first.expiresAt.toISOString(), "2026-08-17T00:00:00.000Z");
  assert.equal(normalizeReviewRequestToken(first.token), first.token);
});

test("supports custom expiry and builds token-only review URL", () => {
  const expiresAt = new Date("2026-07-25T00:00:00.000Z");
  const token = createReviewRequestToken({ now, expiresAt });
  assert.equal(token.expiresAt, expiresAt);
  const url = new URL(buildReviewSubmissionUrl({ baseUrl: "https://example.com/apps/loopd2c", token: token.token }));
  assert.equal(url.pathname, "/customer/reviews/write");
  assert.equal(url.searchParams.get("token"), token.token);
  assert.equal(url.searchParams.has("shopId"), false);
  assert.equal(url.searchParams.has("orderId"), false);
});

test("issue persists only hash and lifecycle metadata", async () => {
  let updateArgs: any;
  const result = await issueReviewRequestToken({ reviewRequestId: "rr", shopId: "shop", now, db: { reviewRequest: { updateMany: async (args: unknown) => { updateArgs = args; return { count: 1 }; } } } as never });
  assert.equal(result.ok, true);
  assert.equal("token" in updateArgs.data, false);
  assert.match(updateArgs.data.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(updateArgs.data.tokenCreatedAt, now);
  assert.equal(updateArgs.data.tokenConsumedAt, null);
  assert.equal(updateArgs.data.tokenRevokedAt, null);
});

test("consume is atomic and rejects second use", async () => {
  const calls: any[] = [];
  const db = { reviewRequest: { updateMany: async (args: unknown) => { calls.push(args); return { count: calls.length === 1 ? 1 : 0 }; } } } as never;
  assert.deepEqual(await consumeReviewRequestToken({ reviewRequestId: "rr", reviewId: "review", consumedAt: now, db }), { ok: true });
  assert.deepEqual(await consumeReviewRequestToken({ reviewRequestId: "rr", reviewId: "review", consumedAt: now, db }), { ok: false, reason: "TOKEN_CONSUMED" });
  assert.deepEqual(calls[0].where, { id: "rr", tokenConsumedAt: null, tokenRevokedAt: null });
  assert.equal(calls[0].data.submittedReviewId, "review");
  assert.equal(calls[0].data.status, "SUBMITTED");
});
