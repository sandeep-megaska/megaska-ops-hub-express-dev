import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REVIEW_SETTINGS, getReviewSettings, normalizeReviewsPerPage, saveReviewSettings, toReviewSettings, type RawReviewSettings, type ReviewSettingsDb } from "./review-settings.ts";
import { normalizeReviewSort } from "./review-sort.ts";

function raw(defaultReviewSort: string, reviewsPerPage = 10): RawReviewSettings {
  return { shopId: "shop-1", ...DEFAULT_REVIEW_SETTINGS, defaultReviewSort, reviewsPerPage };
}

function database(row: RawReviewSettings | null): ReviewSettingsDb {
  return { shop: { findUnique: async () => ({ id: "shop-1" }) }, reviewSettings: { findUnique: async () => row, upsert: async ({ create }) => create } };
}

test("normalizes only supported persisted review sorts", () => {
  assert.equal(normalizeReviewSort("NEWEST"), "NEWEST");
  assert.equal(normalizeReviewSort("HIGHEST_RATING"), "HIGHEST_RATING");
  assert.equal(normalizeReviewSort("LOWEST_RATING"), "LOWEST_RATING");
  assert.equal(normalizeReviewSort("legacy"), "NEWEST");
  assert.equal(normalizeReviewSort(null), "NEWEST");
  assert.equal(normalizeReviewSort(undefined), "NEWEST");
});

test("maps raw Prisma-like settings rows to the normalized domain model", async () => {
  const value = await getReviewSettings("shop-1", database(raw("legacy", 99)));
  assert.equal(value.defaultReviewSort, "NEWEST");
  assert.equal(value.reviewsPerPage, 25);
  assert.equal(normalizeReviewsPerPage(0), 1);
  assert.equal(normalizeReviewsPerPage(26), 25);
  assert.equal(normalizeReviewsPerPage(2.5), 10);
  assert.equal(toReviewSettings(null).reviewsPerPage, 10);
});

test("safe defaults do not write and unsupported saved sorts are rejected", async () => {
  let writes = 0;
  const db: ReviewSettingsDb = { shop: { findUnique: async () => ({ id: "shop-1" }) }, reviewSettings: { findUnique: async () => null, upsert: async ({ create }) => { writes += 1; return create; } } };
  const value = await getReviewSettings("shop-1", db);
  assert.equal(value.reviewsEnabled, false);
  assert.equal(value.shopId, "shop-1");
  assert.equal(writes, 0);
  await assert.rejects(() => saveReviewSettings("shop-1", { automaticRequestsEnabled: true }, db));
});

test("activation updates are tenant-scoped, idempotent, and preserve unrelated settings", async () => {
  const persisted = {
    ...raw("NEWEST"),
    id: "settings-id",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };
  persisted.requestDelayDays = 21;
  let saved: RawReviewSettings | null = persisted;
  let updateData: Record<string, unknown> | undefined;
  const db: ReviewSettingsDb = {
    shop: { findUnique: async ({ where }) => where.id === "shop-1" ? { id: "shop-1" } : null },
    reviewSettings: {
      findUnique: async ({ where }) => where.shopId === "shop-1" ? saved : null,
      upsert: async ({ create, update }) => {
        updateData = update;
        saved = { ...(saved ?? create), ...update };
        return saved;
      },
    },
  };
  const first = await saveReviewSettings("shop-1", { reviewsEnabled: true, automaticRequestsEnabled: true, storefrontReviewsEnabled: false }, db);
  assert.equal(first.requestDelayDays, 21);
  assert.equal(first.reviewsEnabled, true);
  assert.equal(first.automaticRequestsEnabled, true);
  assert.equal(first.storefrontReviewsEnabled, false);
  assert.equal("id" in first, false);
  assert.equal("createdAt" in first, false);
  assert.equal("updatedAt" in first, false);
  assert.equal("id" in (updateData ?? {}), false);
  assert.equal("shopId" in (updateData ?? {}), false);
  assert.equal("createdAt" in (updateData ?? {}), false);
  assert.equal("updatedAt" in (updateData ?? {}), false);
  const second = await saveReviewSettings("shop-1", { reviewsEnabled: true, automaticRequestsEnabled: true, storefrontReviewsEnabled: false }, db);
  assert.deepEqual(second, first);
  await assert.rejects(() => saveReviewSettings("shop-2", { reviewsEnabled: true }, db), /Shop not found/);
});
