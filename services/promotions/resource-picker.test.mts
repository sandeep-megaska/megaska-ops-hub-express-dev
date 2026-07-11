import test from "node:test";
import assert from "node:assert/strict";
import { addProductType, collectionTriggerPickerOptions, normalizeOfferProduct, normalizePickerResources, offerProductPickerOptions, productTriggerPickerOptions } from "./resource-picker.ts";
import { readFileSync } from "node:fs";

const product = { id: "gid://shopify/Product/1", title: "Sock", handle: "sock", image: { url: "https://cdn/p.jpg" }, variants: [{ id: "gid://shopify/ProductVariant/9" }] };
const collection = { id: "gid://shopify/Collection/2", title: "Summer", handle: "summer", image: { originalSrc: "https://cdn/c.jpg" } };

test("normalizes product picker payload and ignores variants", () => {
  assert.deepEqual(normalizePickerResources(product, "PRODUCT"), [{ gid: "gid://shopify/Product/1", title: "Sock", handle: "sock", imageUrl: "https://cdn/p.jpg", resourceType: "PRODUCT" }]);
});

test("normalizes collection picker payload", () => {
  assert.deepEqual(normalizePickerResources(collection, "COLLECTION"), [{ gid: "gid://shopify/Collection/2", title: "Summer", handle: "summer", imageUrl: "https://cdn/c.jpg", resourceType: "COLLECTION" }]);
});

test("rejects ProductVariant and wrong resource-type gids", () => {
  assert.deepEqual(normalizePickerResources({ id: "gid://shopify/ProductVariant/1" }, "PRODUCT"), []);
  assert.deepEqual(normalizePickerResources({ id: "gid://shopify/Collection/1" }, "PRODUCT"), []);
  assert.deepEqual(normalizePickerResources({ id: "gid://shopify/Product/1" }, "COLLECTION"), []);
});

test("uses required image fallback order", () => {
  assert.equal(normalizePickerResources({ id: "gid://shopify/Product/1", image: { originalSrc: "original", url: "url" } }, "PRODUCT")?.[0].imageUrl, "original");
  assert.equal(normalizePickerResources({ id: "gid://shopify/Product/1", image: { url: "image-url" }, images: [{ originalSrc: "orig" }] }, "PRODUCT")?.[0].imageUrl, "image-url");
  assert.equal(normalizePickerResources({ id: "gid://shopify/Product/1", images: [{ originalSrc: "orig", url: "url" }] }, "PRODUCT")?.[0].imageUrl, "orig");
  assert.equal(normalizePickerResources({ id: "gid://shopify/Product/1", images: [{ url: "url" }] }, "PRODUCT")?.[0].imageUrl, "url");
  assert.equal(normalizePickerResources({ id: "gid://shopify/Product/1" }, "PRODUCT")?.[0].imageUrl, null);
});

test("deduplicates duplicate GIDs while preserving deterministic order", () => {
  assert.deepEqual(normalizePickerResources([{ id: "gid://shopify/Product/2" }, { id: "gid://shopify/Product/1" }, { id: "gid://shopify/Product/2", title: "Duplicate" }], "PRODUCT")?.map((r) => r.gid), ["gid://shopify/Product/2", "gid://shopify/Product/1"]);
});

test("treats undefined picker result as cancellation", () => {
  assert.equal(normalizePickerResources(undefined, "PRODUCT"), undefined);
  assert.equal(normalizeOfferProduct(undefined), undefined);
});

test("normalizes product type and prevents duplicate normalized values", () => {
  const values = addProductType([], "  Café  ");
  assert.deepEqual(values, [{ value: "Café", normalizedValue: "café", displayTitle: "Café" }]);
  assert.equal(addProductType(values, "cafe\u0301"), values);
});

test("builds product trigger picker option shape", () => {
  assert.deepEqual(productTriggerPickerOptions(["gid://shopify/Product/1"]), { type: "product", action: "select", multiple: true, selectionIds: [{ id: "gid://shopify/Product/1" }], filter: { variants: false, draft: false, archived: false } });
});

test("builds collection picker option shape with existing selectionIds", () => {
  assert.deepEqual(collectionTriggerPickerOptions(["gid://shopify/Collection/1"]), { type: "collection", action: "select", multiple: true, selectionIds: [{ id: "gid://shopify/Collection/1" }] });
});

test("builds offer-product picker with multiple false and no variant picker", () => {
  assert.equal(normalizeOfferProduct([{ id: "gid://shopify/Product/1" }, { id: "gid://shopify/Product/2" }])?.gid, "gid://shopify/Product/1");
  assert.deepEqual(offerProductPickerOptions("gid://shopify/Product/3"), { type: "product", action: "select", multiple: false, selectionIds: [{ id: "gid://shopify/Product/3" }], filter: { variants: false, draft: false, archived: false } });
  assert.notEqual(offerProductPickerOptions().type, "variant");
  assert.notEqual(productTriggerPickerOptions().type, "variant");
});

test("does not implement custom catalogue search or expose raw GID inputs in normal UX", () => {
  const form = readFileSync(new URL("../../app/admin/promotions/PromotionForm.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(form, /textarea[^>]+name=["']triggerReferences["']/);
  assert.doesNotMatch(form, /type=["']text["'][^>]+name=["']offerProductGid["']/);
  assert.doesNotMatch(form, /custom product search|catalogue search/i);
});
