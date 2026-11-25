import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseMoney, parseShopifyProductsCsv } from "./shopify-products.ts";

const csv = readFileSync(new URL("../../test/fixtures/products_export.csv", import.meta.url), "utf8");

test("normaliseMoney", () => {
  assert.equal(normaliseMoney("995"), "995.00");
  assert.equal(normaliseMoney("995.5"), "995.50");
  assert.equal(normaliseMoney("1,499.00"), "1499.00");
  assert.equal(normaliseMoney(""), null);
  assert.equal(normaliseMoney("abc"), null);
});

test("parses a Shopify product export", () => {
  const { products, warnings } = parseShopifyProductsCsv(csv);
  assert.deepEqual(warnings, []);
  assert.deepEqual(products.map((p) => p.handle), ["black", "classic-unisex-soft-silicone", "draft-thing"]);

  const p = products[0];
  assert.equal(p.title, "Block Color Spandex Full Length Padded One Piece Swimming Costume");
  assert.match(p.descriptionHtml, /"Be free" from bad odour, itching, etc\.<\/p>$/);
  assert.match(p.descriptionHtml, /\n/);
  assert.deepEqual(p.tags, ["One piece", "padded swimsuits", "solid_swimwear", "swimwear"]);
  assert.equal(p.published, true);
  assert.equal(p.status, "active");
  assert.deepEqual(p.options, [
    { name: "Color", values: ["Black", "Wine"] },
    { name: "Size", values: ["S", "M", "L"] },
    { name: "Fabric", values: ["Polyester-Spandex"] },
  ]);
  assert.equal(p.variants.length, 6);
  const v = p.variants[0];
  assert.equal(v.sku, "MBPS07-Black-S");
  assert.deepEqual(v.optionValues, ["Black", "S", "Polyester-Spandex"]);
  assert.equal(v.price, "995.00");
  assert.equal(v.compareAtPrice, "1899.00");
  assert.equal(v.weightGrams, 240);
  assert.equal(v.inventoryTracked, true);
  assert.equal(v.inventoryQuantity, 10);
  assert.equal(v.hsnCode, "61124990", "HSN from the gst_pro.hsn metafield column");
  assert.equal(p.metafields["custom.style_highlights"], '["Full length","Full coverage"]');
  assert.equal(p.media.length, 5, "variant rows and image-only rows both contribute images");
  assert.deepEqual(p.media.map((m) => m.position), [1, 2, 3, 4, 5]);
  assert.equal(p.media[3].alt, "Wine");
});

test("a product with no options and compare-at equal to price", () => {
  const cap = parseShopifyProductsCsv(csv).products[1];
  assert.deepEqual(cap.options, []);
  assert.deepEqual(cap.variants[0].optionValues, []);
  assert.equal(cap.variants[0].price, "299.00");
  assert.equal(cap.variants[0].compareAtPrice, null);
});

test("drafts are kept but not published", () => {
  const d = parseShopifyProductsCsv(csv).products[2];
  assert.equal(d.status, "draft");
  assert.equal(d.published, false);
});

test("duplicate SKUs and missing prices become warnings", () => {
  const text = [
    "Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price",
    "a,A,Size,S,SKU-1,100",
    "a,,Size,M,SKU-2,",
    "b,B,Size,S,sku-1,100",
  ].join("\n");
  const { products, warnings } = parseShopifyProductsCsv(text);
  assert.equal(products.length, 1, "b has no usable variant left");
  assert.equal(warnings.length, 3);
  assert.match(warnings.join("\n"), /no valid price/);
  assert.match(warnings.join("\n"), /SKU sku-1 appears more than once/);
});

test("a file that is not a product export is rejected with a hint", () => {
  assert.throws(() => parseShopifyProductsCsv("Name,Email\nx,y"), /Products > Export/);
});
