import test from "node:test";
import assert from "node:assert/strict";

import { extractPickerVariantPrices } from "./resource-picker-price.ts";

test("extracts price from variant.price", () => {
  assert.equal(extractPickerVariantPrices({ variant: { id: "v1", price: "450" } }).variantPrice, "450");
});

test("extracts price from variant.price.amount", () => {
  assert.equal(extractPickerVariantPrices({ variant: { id: "v1", price: { amount: "450.00" } } }).variantPrice, "450.00");
});

test("extracts price from variant.priceV2.amount", () => {
  assert.equal(extractPickerVariantPrices({ variant: { id: "v1", priceV2: { amount: "451.00" } } }).variantPrice, "451.00");
});

test("extracts price from selectedVariant.price", () => {
  assert.deepEqual(extractPickerVariantPrices({ selectedVariant: { id: "v1", price: 450 } }), { variantPrice: "450", variantCompareAtPrice: null, priceSource: "selected_variant", compareAtPriceSource: "unavailable" });
});

test("extracts price from variants.nodes[0].price", () => {
  assert.deepEqual(extractPickerVariantPrices({ variants: { nodes: [{ id: "v1", price: "452" }] } }), { variantPrice: "452", variantCompareAtPrice: null, priceSource: "first_variant", compareAtPriceSource: "unavailable" });
});

test("extracts compare-at equivalents", () => {
  assert.deepEqual(extractPickerVariantPrices({ selectedVariant: { id: "v1", price: "450", compareAtPrice: { amount: "500" } } }), { variantPrice: "450", variantCompareAtPrice: "500", priceSource: "selected_variant", compareAtPriceSource: "selected_variant" });
  assert.equal(extractPickerVariantPrices({ variant: { compareAtPriceV2: { amount: "501" } } }).variantCompareAtPrice, "501");
  assert.equal(extractPickerVariantPrices({ variants: [{ compareAtPrice: "502" }] }).variantCompareAtPrice, "502");
  assert.equal(extractPickerVariantPrices({ variants: { nodes: [{ compareAtPrice: { amount: "503" } }] } }).variantCompareAtPrice, "503");
});

test("malformed payload returns unavailable", () => {
  assert.deepEqual(extractPickerVariantPrices(null), { variantPrice: null, variantCompareAtPrice: null, priceSource: "unavailable", compareAtPriceSource: "unavailable" });
});

test("numeric and string prices normalize", () => {
  assert.equal(extractPickerVariantPrices({ variant: { price: 12.5 } }).variantPrice, "12.5");
  assert.equal(extractPickerVariantPrices({ variant: { price: " 12.50 " } }).variantPrice, "12.50");
});
