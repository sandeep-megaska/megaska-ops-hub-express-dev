import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShopifyProductId, shopifyProductIdCandidates } from "./shopify-product-id.ts";

test("normalizes numeric and GID Shopify product IDs to the numeric form", () => {
  assert.equal(normalizeShopifyProductId("10092273140010"), "10092273140010");
  assert.equal(normalizeShopifyProductId("gid://shopify/Product/10092273140010"), "10092273140010");
  assert.deepEqual(shopifyProductIdCandidates("gid://shopify/Product/10092273140010"), [
    "10092273140010",
    "gid://shopify/Product/10092273140010",
  ]);
});
