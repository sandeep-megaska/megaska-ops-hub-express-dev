import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareDecimal, legacyId, mapCollection, mapProduct } from "./map.ts";
import type { ShopifyProduct } from "./types.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../../test/fixtures/product.json", import.meta.url), "utf8"),
) as ShopifyProduct;

test("legacyId extracts the numeric id", () => {
  assert.equal(legacyId("gid://shopify/Product/8680604106888"), "8680604106888");
  assert.equal(legacyId("gid://shopify/MediaImage/35116520013960?v=1"), "35116520013960");
  assert.throws(() => legacyId("not-a-gid"));
});

test("compareDecimal compares money without floats", () => {
  assert.equal(compareDecimal("995.00", "995"), 0);
  assert.equal(compareDecimal("995.5", "995.49"), 1);
  assert.equal(compareDecimal("10", "9.99"), 1);
  assert.equal(compareDecimal("-5.50", "0"), -1);
});

test("mapProduct maps a real Megaska product", () => {
  const { product, variants, media, collectionShopifyIds } = mapProduct(fixture);
  assert.equal(product.handle, "shoulder-swimsuits-coverage-cutout");
  assert.equal(product.status, "ACTIVE");
  assert.equal(product.min_price, "990.00");
  assert.equal(product.max_price, "990.00");
  assert.equal(variants.length, 5);
  assert.equal(variants[0].sku, "MWSW05-Black-S");
  assert.equal(variants[0].compare_at_price, "2899.00");
  assert.equal(variants[0].inventory_policy, "DENY");
  assert.equal(variants[0].hsn_code, "61124990", "falls back to the gst_pro.hsn metafield");
  assert.equal(variants[0].image_shopify_id, "35116493668488");
  assert.equal(media.length, 5);
  assert.equal(media[0].position, 1);
  assert.match(media[0].url, /^https:\/\/cdn\.shopify\.com\//);
  assert.equal(collectionShopifyIds.length, 3);
});

test("mapProduct drops Judge.me widget HTML but keeps other metafields", () => {
  const { product } = mapProduct(fixture);
  assert.ok(!Object.keys(product.metafields).some((k) => k.startsWith("judgeme.")));
  assert.equal(product.metafields["custom.discount_percent"]?.type, "number_integer");
  assert.ok(product.metafields["gst_pro.hsn"]);
});

test("compare-at price at or below the price is not a discount", () => {
  const p = structuredClone(fixture);
  p.variants.nodes[0].compareAtPrice = "990.00";
  p.variants.nodes[1].compareAtPrice = "500.00";
  const { variants } = mapProduct(p);
  assert.equal(variants[0].compare_at_price, null);
  assert.equal(variants[1].compare_at_price, null);
});

test("media without a ready image is skipped, positions follow Shopify order", () => {
  const p = structuredClone(fixture);
  p.media.nodes.splice(1, 0, { id: "gid://shopify/Video/1", mediaContentType: "VIDEO", alt: null, preview: { image: null } });
  const { media } = mapProduct(p);
  assert.equal(media.length, 5);
  assert.deepEqual(media.map((m) => m.position), [1, 3, 4, 5, 6]);
});

test("mapCollection blanks empty strings", () => {
  const row = mapCollection({
    id: "gid://shopify/Collection/267342872712",
    handle: "lounge-shorts",
    title: "Lounge Shorts",
    descriptionHtml: "",
    updatedAt: "2026-10-22T15:41:39Z",
    sortOrder: "BEST_SELLING",
    templateSuffix: "",
    seo: { title: null, description: null },
    image: null,
    metafields: { nodes: [] },
  });
  assert.equal(row.shopify_id, "267342872712");
  assert.equal(row.template_suffix, null);
  assert.equal(row.image_url, null);
});
