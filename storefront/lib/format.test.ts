import { test } from "node:test";
import assert from "node:assert/strict";
import { discountPercent, formatPrice, shopifyImageUrl } from "./format.ts";

test("formatPrice", () => {
  assert.equal(formatPrice("995.00"), "₹995");
  assert.equal(formatPrice("1499.00"), "₹1,499");
  assert.equal(formatPrice("995.50"), "₹995.50");
  assert.equal(formatPrice(null), "");
});

test("discountPercent", () => {
  assert.equal(discountPercent("995.00", "1899.00"), 48);
  assert.equal(discountPercent("995.00", "995.00"), null);
  assert.equal(discountPercent("995.00", null), null);
});

test("shopifyImageUrl sets width only on Shopify's CDN", () => {
  const u = shopifyImageUrl("https://cdn.shopify.com/s/files/1/x.jpg?v=1758315600", 540);
  assert.equal(u, "https://cdn.shopify.com/s/files/1/x.jpg?v=1758315600&width=540");
  assert.equal(shopifyImageUrl("https://example.com/a.jpg", 540), "https://example.com/a.jpg");
});
