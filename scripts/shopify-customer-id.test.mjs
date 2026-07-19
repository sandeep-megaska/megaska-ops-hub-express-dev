import assert from "node:assert/strict";
import test from "node:test";
import { InvalidShopifyCustomerIdError, normalizeShopifyCustomerId, shopifyCustomerIdStorageForms } from "../lib/shopify-customer-id.ts";

test("numeric and Customer GID forms have one canonical identity", () => {
  assert.equal(normalizeShopifyCustomerId("10359580655914"), "10359580655914");
  assert.equal(normalizeShopifyCustomerId("gid://shopify/Customer/10359580655914"), "10359580655914");
  assert.deepEqual(shopifyCustomerIdStorageForms("10359580655914"), ["10359580655914", "gid://shopify/Customer/10359580655914"]);
});

test("different customers remain different and non-Customer GIDs are rejected", () => {
  assert.notEqual(normalizeShopifyCustomerId("1"), normalizeShopifyCustomerId("2"));
  assert.throws(() => normalizeShopifyCustomerId("gid://shopify/Product/10359580655914"), InvalidShopifyCustomerIdError);
  assert.throws(() => normalizeShopifyCustomerId("not-an-id"), InvalidShopifyCustomerIdError);
});
