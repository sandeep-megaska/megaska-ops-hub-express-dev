import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShopifyCustomerId } from "./shopify-customer-id.ts";

test("normalizes numeric and Shopify GID customer identities", () => {
  assert.equal(normalizeShopifyCustomerId(" 12345 "), "12345");
  assert.equal(normalizeShopifyCustomerId("gid://shopify/Customer/12345"), "12345");
});

test("rejects empty, malformed, and wrong-resource identities", () => {
  for (const value of [null, "", "customer/12", "gid://shopify/Order/12", "12x"]) {
    assert.equal(normalizeShopifyCustomerId(value), null);
  }
});
