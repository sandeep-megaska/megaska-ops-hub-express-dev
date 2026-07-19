import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmail, normalizePhone, normalizeShopifyCustomerId } from "./customer-identity-normalization.ts";

test("adversarial Indian phone representations normalize to one identity", () => {
  const representations = ["9876543210", "+919876543210", "91 9876543210", "+91-98765-43210"];
  assert.deepEqual(new Set(representations.map((phone) => normalizePhone(phone))), new Set(["+919876543210"]));
});

test("Shopify GID and numeric forms normalize to one identity", () => {
  assert.equal(normalizeShopifyCustomerId("gid://shopify/Customer/123"), "123");
  assert.equal(normalizeShopifyCustomerId(" 123 "), "123");
  assert.throws(() => normalizeShopifyCustomerId("gid://shopify/Order/123"), /malformed/);
});

test("email case and surrounding whitespace normalize consistently", () => {
  assert.equal(normalizeEmail("  Customer@Example.COM  "), "customer@example.com");
  assert.throws(() => normalizeEmail("customer @example.com"), /malformed/);
});
