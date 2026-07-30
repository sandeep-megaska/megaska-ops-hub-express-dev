import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvToRecords } from "./review-csv.ts";
import { normalizeImportRows } from "./review-import-mapping.ts";

const NOW = new Date("2026-07-30T00:00:00.000Z");

function run(csv: string, options = {}) {
  const { records } = parseCsvToRecords(csv);
  return normalizeImportRows(records, { now: NOW, ...options });
}

test("maps a Judge.me-style export into the canonical shape", () => {
  const csv = [
    "product_handle,product_external_id,rating,title,body,reviewer_name,reviewer_email,review_date,published,picture_urls,reply",
    "blue-shirt,111,5,Great,Loved it,Asha,asha@example.com,2026-06-01,true,https://cdn/a.jpg https://cdn/b.jpg,Thanks!",
  ].join("\n");
  const preview = run(csv, { platform: "judge_me" });
  assert.equal(preview.validCount, 1);
  assert.equal(preview.errorCount, 0);
  const row = preview.rows[0];
  assert.equal(row.shopifyProductId, "111");
  assert.equal(row.productHandle, "blue-shirt");
  assert.equal(row.rating, 5);
  assert.equal(row.title, "Great");
  assert.equal(row.body, "Loved it");
  assert.equal(row.customerDisplayName, "Asha");
  assert.equal(row.authorEmail, "asha@example.com");
  assert.equal(row.status, "PUBLISHED");
  assert.equal(row.replyBody, "Thanks!");
  assert.deepEqual(row.mediaUrls, ["https://cdn/a.jpg", "https://cdn/b.jpg"]);
  assert.equal(row.submittedAt.toISOString().slice(0, 10), "2026-06-01");
  // publishedAt backfilled from submittedAt for a published review.
  assert.equal(row.publishedAt?.toISOString().slice(0, 10), "2026-06-01");
});

test("maps a Shopify Product Reviews-style export (state column)", () => {
  const csv = [
    "product_handle,state,rating,author,email,title,body,reply,created_at,product_id",
    "blue-shirt,published,4,Ravi,ravi@example.com,Nice,Good product,Glad you liked it,2026-05-01,111",
  ].join("\n");
  const preview = run(csv, { platform: "shopify_native" });
  const row = preview.rows[0];
  assert.equal(row.rating, 4);
  assert.equal(row.customerDisplayName, "Ravi");
  assert.equal(row.status, "PUBLISHED");
  assert.equal(row.replyBody, "Glad you liked it");
  assert.equal(row.shopifyProductId, "111");
});

test("rating must be a whole number 1-5, else the row is an error", () => {
  for (const bad of ["abc", "0", "7", ""]) {
    const preview = run(`rating,product_id,author\n${bad},1,X`);
    assert.equal(preview.validCount, 0, `expected invalid for rating='${bad}'`);
    assert.equal(preview.errors[0].csvLine, 2);
  }
  // Decimal ratings round to the nearest star.
  assert.equal(run("rating,product_id,author\n4.6,1,X").rows[0].rating, 5);
});

test("a row with neither product_id nor product_handle is an error", () => {
  const preview = run("rating,author,body\n5,Asha,Nice");
  assert.equal(preview.validCount, 0);
  assert.match(preview.errors[0].message, /product reference/i);
});

test("status/state tokens map to enum values; booleans too", () => {
  const cases: Array<[string, string]> = [
    ["published", "PUBLISHED"], ["true", "PUBLISHED"], ["ok", "PUBLISHED"], ["approved", "PUBLISHED"],
    ["queued", "PENDING_MODERATION"], ["false", "PENDING_MODERATION"], ["pending", "PENDING_MODERATION"],
    ["spam", "REJECTED"], ["rejected", "REJECTED"],
    ["hidden", "HIDDEN"], ["unpublished", "HIDDEN"],
  ];
  for (const [token, expected] of cases) {
    const preview = run(`product_id,rating,author,status\n1,5,A,${token}`);
    assert.equal(preview.rows[0].status, expected, `token='${token}'`);
  }
});

test("absent status falls back to the configured default (PUBLISHED) and backfills publishedAt", () => {
  const preview = run("product_id,rating,author\n1,5,A");
  assert.equal(preview.rows[0].status, "PUBLISHED");
  assert.equal(preview.rows[0].publishedAt?.toISOString(), preview.rows[0].submittedAt.toISOString());
  const pendingDefault = run("product_id,rating,author\n1,5,A", { defaultStatus: "PENDING_MODERATION" });
  assert.equal(pendingDefault.rows[0].status, "PENDING_MODERATION");
  assert.equal(pendingDefault.rows[0].publishedAt, null);
});

test("verified_purchase parses truthy tokens and defaults to false", () => {
  assert.equal(run("product_id,rating,author,verified\n1,5,A,true").rows[0].verifiedPurchase, true);
  assert.equal(run("product_id,rating,author,verified\n1,5,A,no").rows[0].verifiedPurchase, false);
  assert.equal(run("product_id,rating,author\n1,5,A").rows[0].verifiedPurchase, false);
  assert.equal(run("product_id,rating,author\n1,5,A", { defaultVerified: true }).rows[0].verifiedPurchase, true);
});

test("a Shopify product gid is reduced to its numeric id", () => {
  const preview = run("product_id,rating,author\ngid://shopify/Product/999,5,A");
  assert.equal(preview.rows[0].shopifyProductId, "999");
});

test("a blank author becomes 'Anonymous'", () => {
  const preview = run("product_id,rating,author\n1,5,");
  assert.equal(preview.rows[0].customerDisplayName, "Anonymous");
});

test("identical rows are de-duplicated within the file", () => {
  const csv = [
    "product_id,rating,author,body,review_date",
    "1,5,Asha,Loved it,2026-06-01",
    "1,5,Asha,Loved it,2026-06-01",
    "1,4,Asha,Loved it,2026-06-01",
  ].join("\n");
  const preview = run(csv);
  assert.equal(preview.validCount, 2);
  assert.equal(preview.duplicatesSkipped, 1);
});

test("valid and invalid rows are reported together with correct line numbers", () => {
  const csv = [
    "product_id,rating,author",
    "1,5,Asha",   // line 2 valid
    ",5,NoProduct", // line 3 error (no product)
    "2,9,BadRating", // line 4 error (rating out of range)
  ].join("\n");
  const preview = run(csv);
  assert.equal(preview.totalDataRows, 3);
  assert.equal(preview.validCount, 1);
  assert.equal(preview.errorCount, 2);
  assert.deepEqual(preview.errors.map((e) => e.csvLine), [3, 4]);
});

test("title, body, and name are length-capped", () => {
  const long = "x".repeat(6000);
  const preview = run(`product_id,rating,author,title,body\n1,5,${"n".repeat(200)},${long},${long}`);
  const row = preview.rows[0];
  assert.equal(row.customerDisplayName.length, 100);
  assert.equal(row.title?.length, 150);
  assert.equal(row.body?.length, 5000);
});
