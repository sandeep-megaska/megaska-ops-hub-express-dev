import assert from "node:assert/strict";
import test from "node:test";
import { buildInternalApiUrl, isPublicApiPath, isStorefrontApiPath } from "./routing.ts";

test("customer-safe review routes are available through the storefront proxy", () => {
  for (const path of [
    "reviews/storefront/product",
    "reviews/submissions/eligible-purchases",
    "reviews/submissions/eligibility",
    "reviews/submissions",
  ]) {
    assert.equal(isStorefrontApiPath(path), true);
    assert.equal(isPublicApiPath(path), true);
  }
});

test("eligible purchase forwarding preserves product and variant query parameters", () => {
  const target = buildInternalApiUrl(
    "https://example.test/apps/loopd2c/api/reviews/submissions/eligible-purchases?productId=123&variantId=456&signature=secret&hmac=secret",
    "reviews/submissions/eligible-purchases",
    "shop.example.com",
  );

  assert.equal(target.pathname, "/api/reviews/submissions/eligible-purchases");
  assert.equal(target.searchParams.get("productId"), "123");
  assert.equal(target.searchParams.get("variantId"), "456");
  assert.equal(target.searchParams.get("shop"), "shop.example.com");
  assert.equal(target.searchParams.has("signature"), false);
  assert.equal(target.searchParams.has("hmac"), false);
});

test("unsupported and admin routes remain unavailable", () => {
  assert.equal(isPublicApiPath("reviews/submissions/unsupported"), false);
  assert.equal(isStorefrontApiPath("reviews/submissions/unsupported"), false);
  assert.equal(isPublicApiPath("admin/reviews/settings"), false);
  assert.equal(isStorefrontApiPath("admin/reviews/settings"), false);
});
