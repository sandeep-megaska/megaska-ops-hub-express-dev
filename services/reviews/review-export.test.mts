import test from "node:test";
import assert from "node:assert/strict";
import { reviewRowsToCsv, REVIEW_EXPORT_HEADERS, MEDIA_URL_SEPARATOR, type ExportableReview } from "./review-export.ts";

function baseReview(overrides: Partial<ExportableReview> = {}): ExportableReview {
  return {
    id: "rev_1",
    shopifyProductId: "111",
    productHandleSnapshot: "blue-shirt",
    shopifyVariantId: "222",
    productTitleSnapshot: "Blue Shirt",
    rating: 5,
    title: "Great",
    body: "Loved it",
    customerDisplayName: "Asha",
    verifiedPurchase: true,
    status: "PUBLISHED",
    source: "VERIFIED_PURCHASE",
    submittedAt: new Date("2026-07-01T10:00:00.000Z"),
    publishedAt: new Date("2026-07-02T10:00:00.000Z"),
    merchantReply: null,
    media: [],
    ...overrides,
  };
}

function parseCsvRow(line: string): string[] {
  // Minimal RFC-4180 field splitter for test assertions.
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else if (char === '"') { inQuotes = true; }
    else if (char === ",") { fields.push(field); field = ""; }
    else { field += char; }
  }
  fields.push(field);
  return fields;
}

test("header row matches the canonical contract", () => {
  const { csv } = reviewRowsToCsv([]);
  assert.equal(csv.split("\r\n")[0], REVIEW_EXPORT_HEADERS.join(","));
});

test("empty input yields header only and rowCount 0", () => {
  const { csv, rowCount } = reviewRowsToCsv([]);
  assert.equal(rowCount, 0);
  assert.equal(csv.split("\r\n").length, 1);
});

test("a basic review maps to the canonical columns", () => {
  const { csv, rowCount } = reviewRowsToCsv([baseReview()]);
  assert.equal(rowCount, 1);
  const row = parseCsvRow(csv.split("\r\n")[1]);
  const cell = (name: (typeof REVIEW_EXPORT_HEADERS)[number]) => row[REVIEW_EXPORT_HEADERS.indexOf(name)];
  assert.equal(cell("review_id"), "rev_1");
  assert.equal(cell("product_id"), "111");
  assert.equal(cell("product_handle"), "blue-shirt");
  assert.equal(cell("variant_id"), "222");
  assert.equal(cell("product_title"), "Blue Shirt");
  assert.equal(cell("rating"), "5");
  assert.equal(cell("author_name"), "Asha");
  assert.equal(cell("verified_purchase"), "true");
  assert.equal(cell("status"), "published");
  assert.equal(cell("source"), "verified_purchase");
  assert.equal(cell("submitted_at"), "2026-07-01T10:00:00.000Z");
  assert.equal(cell("published_at"), "2026-07-02T10:00:00.000Z");
});

test("commas, quotes, and newlines in the body are RFC-4180 escaped", () => {
  const nasty = 'Great, "five" stars\nwould buy again';
  const { csv, rowCount } = reviewRowsToCsv([baseReview({ body: nasty })]);
  // Embedded newline keeps the logical row intact (still one row) and the cell
  // is quoted with doubled inner quotes.
  assert.equal(rowCount, 1);
  assert.ok(csv.includes('"Great, ""five"" stars\nwould buy again"'));
  // Header stays a clean single line before the quoted multiline cell begins.
  assert.equal(csv.split("\n")[0].replace(/\r$/, ""), REVIEW_EXPORT_HEADERS.join(","));
});

test("multiple media URLs join with the pipe separator, falling back to thumbnails", () => {
  const { csv } = reviewRowsToCsv([
    baseReview({
      media: [
        { publicUrl: "https://cdn/a.jpg" },
        { publicUrl: null, thumbnailUrl: "https://cdn/b-thumb.jpg" },
        { publicUrl: "", thumbnailUrl: "" },
      ],
    }),
  ]);
  const row = parseCsvRow(csv.split("\r\n")[1]);
  assert.equal(
    row[REVIEW_EXPORT_HEADERS.indexOf("media_urls")],
    ["https://cdn/a.jpg", "https://cdn/b-thumb.jpg"].join(MEDIA_URL_SEPARATOR),
  );
});

test("merchant reply body and author populate their columns", () => {
  const { csv } = reviewRowsToCsv([
    baseReview({ merchantReply: { body: "Thanks!", authorLabel: "Store team" } }),
  ]);
  const row = parseCsvRow(csv.split("\r\n")[1]);
  assert.equal(row[REVIEW_EXPORT_HEADERS.indexOf("reply_body")], "Thanks!");
  assert.equal(row[REVIEW_EXPORT_HEADERS.indexOf("reply_author")], "Store team");
});

test("null title/body/handle/variant render as empty cells, not the string 'null'", () => {
  const { csv } = reviewRowsToCsv([
    baseReview({ title: null, body: null, productHandleSnapshot: null, shopifyVariantId: null, publishedAt: null }),
  ]);
  const row = parseCsvRow(csv.split("\r\n")[1]);
  assert.equal(row[REVIEW_EXPORT_HEADERS.indexOf("title")], "");
  assert.equal(row[REVIEW_EXPORT_HEADERS.indexOf("body")], "");
  assert.equal(row[REVIEW_EXPORT_HEADERS.indexOf("product_handle")], "");
  assert.equal(row[REVIEW_EXPORT_HEADERS.indexOf("variant_id")], "");
  assert.equal(row[REVIEW_EXPORT_HEADERS.indexOf("published_at")], "");
});

test("unverified pending review maps to false/pending tokens", () => {
  const { csv } = reviewRowsToCsv([
    baseReview({ verifiedPurchase: false, status: "PENDING_MODERATION", source: "MANUAL_IMPORT" }),
  ]);
  const row = parseCsvRow(csv.split("\r\n")[1]);
  assert.equal(row[REVIEW_EXPORT_HEADERS.indexOf("verified_purchase")], "false");
  assert.equal(row[REVIEW_EXPORT_HEADERS.indexOf("status")], "pending");
  assert.equal(row[REVIEW_EXPORT_HEADERS.indexOf("source")], "manual_import");
});
