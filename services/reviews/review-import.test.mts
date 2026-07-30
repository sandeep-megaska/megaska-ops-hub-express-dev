import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvToRecords } from "./review-csv.ts";
import { normalizeImportRows } from "./review-import-mapping.ts";
import { buildReviewCreateData, importReviews, type ReviewImportDb } from "./review-import.ts";

const NOW = new Date("2026-07-30T00:00:00.000Z");

function firstRow(csv: string) {
  const { records } = parseCsvToRecords(csv);
  return normalizeImportRows(records, { now: NOW }).rows[0];
}

type CreatedReview = { id: string } & Record<string, unknown>;

function fakeDb(existing: Array<{ shopifyProductId: string; customerDisplayName: string; rating: number; body: string | null; submittedAt: Date }> = []) {
  const reviews: CreatedReview[] = [];
  const media: Record<string, unknown>[] = [];
  const replies: Record<string, unknown>[] = [];
  let counter = 0;
  const db: ReviewImportDb = {
    productReview: {
      async findMany() {
        return existing;
      },
      async create(args) {
        const data = (args as { data: Record<string, unknown> }).data;
        const row = { id: `rev_${(counter += 1)}`, ...data };
        reviews.push(row);
        return { id: row.id };
      },
    },
    productReviewMedia: {
      async create(args) {
        media.push((args as { data: Record<string, unknown> }).data);
        return {};
      },
    },
    productReviewMerchantReply: {
      async create(args) {
        replies.push((args as { data: Record<string, unknown> }).data);
        return {};
      },
    },
  };
  return { db, reviews, media, replies };
}

test("buildReviewCreateData marks a published import as moderated and MANUAL_IMPORT", () => {
  const row = firstRow(
    "product_id,rating,author,title,body,variant_id,product_handle,status,review_date\n111,5,Asha,Great,Loved it,gid://shopify/ProductVariant/222,blue-shirt,published,2026-06-01",
  );
  const data = buildReviewCreateData(row, "shop_1", "111");
  assert.equal(data.source, "MANUAL_IMPORT");
  assert.equal(data.status, "PUBLISHED");
  assert.equal(data.shopifyProductId, "111");
  assert.equal(data.shopifyVariantId, "222");
  assert.equal(data.productHandleSnapshot, "blue-shirt");
  assert.equal(data.moderationNote, "Imported via CSV");
  assert.ok(data.moderatedAt instanceof Date);
  assert.equal(data.moderatedAt?.toISOString(), data.publishedAt?.toISOString());
});

test("buildReviewCreateData leaves a pending import unmoderated", () => {
  const row = firstRow("product_id,rating,author,status\n111,4,Ravi,queued");
  const data = buildReviewCreateData(row, "shop_1", "111");
  assert.equal(data.status, "PENDING_MODERATION");
  assert.equal(data.moderatedAt, null);
  assert.equal(data.publishedAt, null);
});

test("importReviews creates reviews, media, and replies, and recomputes each product's aggregate", async () => {
  const csv = [
    "product_id,rating,author,body,review_date,picture_urls,reply",
    "111,5,Asha,Loved it,2026-06-01,https://cdn/a.jpg https://cdn/b.jpg,Thanks!",
    "222,4,Ravi,Nice,2026-06-02,,",
  ].join("\n");
  const { db, reviews, media, replies } = fakeDb();
  const recomputed: string[] = [];
  const result = await importReviews(
    { shopId: "shop_1", csv, now: NOW },
    { db, recalculate: async (_shopId, productId) => void recomputed.push(productId) },
  );

  assert.equal(result.created, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.unmatched, 0);
  assert.equal(result.affectedProducts, 2);
  assert.equal(reviews.length, 2);
  assert.equal(media.length, 2); // two picture urls on the first review
  assert.equal(replies.length, 1);
  assert.deepEqual(recomputed.sort(), ["111", "222"]);
});

test("importReviews skips reviews that already exist (natural-key dedup)", async () => {
  const csv = "product_id,rating,author,body,review_date\n111,5,Asha,Loved it,2026-06-01";
  const { db, reviews } = fakeDb([
    { shopifyProductId: "111", customerDisplayName: "Asha", rating: 5, body: "Loved it", submittedAt: new Date("2026-06-01T00:00:00.000Z") },
  ]);
  const result = await importReviews({ shopId: "shop_1", csv, now: NOW }, { db, recalculate: async () => undefined });
  assert.equal(result.created, 0);
  assert.equal(result.duplicatesSkippedExisting, 1);
  assert.equal(reviews.length, 0);
});

test("handle-only rows are unmatched when no shop domain is available to resolve them", async () => {
  const csv = "product_handle,rating,author\nblue-shirt,5,Asha";
  const { db, reviews } = fakeDb();
  // No shopDomain -> no Admin API resolution possible.
  const result = await importReviews({ shopId: "shop_1", csv, now: NOW }, { db, recalculate: async () => undefined });
  assert.equal(result.unmatched, 1);
  assert.equal(result.created, 0);
  assert.equal(reviews.length, 0);
  assert.match(result.errors[0].message, /could not resolve product_handle/i);
});

test("handle-only rows are resolved to a product id via the injected resolver", async () => {
  const csv = "product_handle,rating,author,body\nblue-shirt,5,Asha,Loved it";
  const { db, reviews } = fakeDb();
  const result = await importReviews(
    { shopId: "shop_1", shopDomain: "megaskastore.myshopify.com", csv, now: NOW },
    {
      db,
      recalculate: async () => undefined,
      resolveHandles: async (handles) => {
        assert.deepEqual(handles, ["blue-shirt"]);
        return new Map([["blue-shirt", "555"]]);
      },
    },
  );
  assert.equal(result.created, 1);
  assert.equal(result.unmatched, 0);
  assert.equal(result.productsResolvedByHandle, 1);
  assert.equal((reviews[0] as { shopifyProductId?: string }).shopifyProductId, "555");
});

test("unresolvable handles are reported unmatched while resolvable ones import", async () => {
  const csv = [
    "product_handle,rating,author",
    "known-product,5,Asha",
    "ghost-product,4,Ravi",
  ].join("\n");
  const { db, reviews } = fakeDb();
  const result = await importReviews(
    { shopId: "shop_1", shopDomain: "megaskastore.myshopify.com", csv, now: NOW },
    {
      db,
      recalculate: async () => undefined,
      resolveHandles: async () => new Map([["known-product", "777"]]),
    },
  );
  assert.equal(result.created, 1);
  assert.equal(result.productsResolvedByHandle, 1);
  assert.equal(result.unmatched, 1);
  assert.equal(reviews.length, 1);
  assert.match(result.errors.find((e) => e.csvLine === 3)?.message ?? "", /ghost-product/);
});

test("dry run counts would-create rows without writing", async () => {
  const csv = "product_id,rating,author\n111,5,Asha\n222,4,Ravi";
  const { db, reviews, media } = fakeDb();
  let recalcCalls = 0;
  const result = await importReviews(
    { shopId: "shop_1", csv, dryRun: true, now: NOW },
    { db, recalculate: async () => void (recalcCalls += 1) },
  );
  assert.equal(result.dryRun, true);
  assert.equal(result.created, 2); // would-create
  assert.equal(reviews.length, 0);
  assert.equal(media.length, 0);
  assert.equal(recalcCalls, 0);
});

test("missing shopId fails closed", async () => {
  await assert.rejects(() => importReviews({ shopId: "", csv: "product_id,rating,author\n1,5,A" }), /shopId is required/);
});
