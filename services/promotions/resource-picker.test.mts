import test from "node:test";
import assert from "node:assert/strict";
import { addProductType, collectionTriggerPickerOptions, normalizeOfferProduct, normalizePickerResources, offerProductPickerOptions, productTriggerPickerOptions } from "./resource-picker.ts";

const product = { id: "gid://shopify/Product/1", title: "Sock", handle: "sock", image: { url: "https://cdn/p.jpg" }, variants: [{ id: "gid://shopify/ProductVariant/9" }] };
const collection = { id: "gid://shopify/Collection/2", title: "Summer", handle: "summer", image: { originalSrc: "https://cdn/c.jpg" } };

test("normalizes product picker payload and ignores variants", () => {
  assert.deepEqual(normalizePickerResources(product, "PRODUCT"), [{ gid: "gid://shopify/Product/1", title: "Sock", handle: "sock", imageUrl: "https://cdn/p.jpg", resourceType: "PRODUCT" }]);
});

test("normalizes collection picker payload", () => {
  assert.deepEqual(normalizePickerResources(collection, "COLLECTION"), [{ gid: "gid://shopify/Collection/2", title: "Summer", handle: "summer", imageUrl: "https://cdn/c.jpg", resourceType: "COLLECTION" }]);
});

test("rejects incorrect gid types and variant gids", () => {
  assert.deepEqual(normalizePickerResources({ id: "gid://shopify/Collection/1" }, "PRODUCT"), []);
  assert.deepEqual(normalizePickerResources({ id: "gid://shopify/ProductVariant/1" }, "PRODUCT"), []);
  assert.deepEqual(normalizePickerResources({ id: "gid://shopify/Product/1" }, "COLLECTION"), []);
});

test("uses image fallback order", () => {
  assert.equal(normalizePickerResources({ id: "gid://shopify/Product/1", images: [{ originalSrc: "orig" }] }, "PRODUCT")?.[0].imageUrl, "orig");
  assert.equal(normalizePickerResources({ id: "gid://shopify/Product/1", images: [{ url: "url", originalSrc: "orig" }] }, "PRODUCT")?.[0].imageUrl, "url");
  assert.equal(normalizePickerResources({ id: "gid://shopify/Product/1", image: { originalSrc: "image-orig" }, images: [{ url: "url" }] }, "PRODUCT")?.[0].imageUrl, "image-orig");
  assert.equal(normalizePickerResources({ id: "gid://shopify/Product/1" }, "PRODUCT")?.[0].imageUrl, null);
});

test("deduplicates duplicate resources while preserving stable order", () => {
  assert.deepEqual(normalizePickerResources([{ id: "gid://shopify/Product/2" }, { id: "gid://shopify/Product/1" }, { id: "gid://shopify/Product/2", title: "Duplicate" }], "PRODUCT")?.map((r) => r.gid), ["gid://shopify/Product/2", "gid://shopify/Product/1"]);
});

test("treats picker cancellation as undefined", () => {
  assert.equal(normalizePickerResources(undefined, "PRODUCT"), undefined);
  assert.equal(normalizeOfferProduct(undefined), undefined);
});

test("normalizes product type and prevents duplicate normalized values", () => {
  const values = addProductType([], "  Café  ");
  assert.deepEqual(values, [{ value: "Café", normalizedValue: "café", displayTitle: "Café" }]);
  assert.equal(addProductType(values, "cafe\u0301"), values);
});

test("builds product picker option shape without variant picker", () => {
  assert.deepEqual(productTriggerPickerOptions(["gid://shopify/Product/1"]), { type: "product", action: "select", multiple: true, selectionIds: [{ id: "gid://shopify/Product/1" }], showVariants: false, filter: { archived: false } });
  assert.notEqual(productTriggerPickerOptions().type, "variant");
});

test("builds collection picker option shape", () => {
  assert.deepEqual(collectionTriggerPickerOptions(["gid://shopify/Collection/1"]), { type: "collection", action: "select", multiple: true, selectionIds: [{ id: "gid://shopify/Collection/1" }] });
});

test("normalizes offer product as single selection and preloads existing selection", () => {
  assert.equal(normalizeOfferProduct([{ id: "gid://shopify/Product/1" }, { id: "gid://shopify/Product/2" }])?.gid, "gid://shopify/Product/1");
  assert.deepEqual(offerProductPickerOptions("gid://shopify/Product/3"), { type: "product", action: "select", multiple: false, selectionIds: [{ id: "gid://shopify/Product/3" }], showVariants: false, filter: { archived: false } });
  assert.notEqual(offerProductPickerOptions().type, "variant");
});
