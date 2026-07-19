import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseShopifyCustomerId, normalizeShopifyCustomerId } from "./shopify-customer-id.ts";

test("normalizes numeric and Shopify GID customer identities", () => {
  assert.equal(normalizeShopifyCustomerId(" 12345 "), "12345");
  assert.equal(normalizeShopifyCustomerId("gid://shopify/Customer/12345"), "12345");
});

test("rejects empty, malformed, and wrong-resource identities", () => {
  for (const value of [null, "", "customer/12", "gid://shopify/Order/12", "gid://shopify/Customer/nope", "-12", "1.2", "12x", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeShopifyCustomerId(value), null);
  }
});

test("preserves oversized strings and bigint without JavaScript number coercion", () => {
  assert.equal(normalizeShopifyCustomerId("999999999999999999999999999999"), "999999999999999999999999999999");
  assert.equal(normalizeShopifyCustomerId(BigInt("10359580655914")), "10359580655914");
  assert.equal(normalizeShopifyCustomerId(123), "123");
});

test("reports typed invalid-value diagnostics", () => {
  assert.equal(diagnoseShopifyCustomerId("123").category, "VALID_NUMERIC");
  assert.equal(diagnoseShopifyCustomerId("gid://shopify/Customer/123").category, "VALID_CUSTOMER_GID");
  assert.equal(diagnoseShopifyCustomerId("gid://shopify/Order/123").category, "WRONG_RESOURCE_TYPE");
  assert.equal(diagnoseShopifyCustomerId("gid://shopify/Customer/nope").category, "MALFORMED_GID");
  assert.equal(diagnoseShopifyCustomerId("anything").category, "NON_NUMERIC");
});
