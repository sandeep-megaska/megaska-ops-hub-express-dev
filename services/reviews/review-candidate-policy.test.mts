import assert from "node:assert/strict";
import test from "node:test";
import { decideReviewCandidateLine, normalizeHttpsImageUrl, normalizeVariantTitle } from "./review-candidate-policy.ts";
const line = (overrides = {}) => ({ shopifyLineItemId: "gid://shopify/LineItem/1", shopifyProductId: "gid://shopify/Product/1", shopifyVariantId: null, title: "Product", productTitle: "Product", variantTitle: null, productHandle: "product", productImageUrl: null, sku: null, quantity: 3, currentQuantity: 3, fulfillableQuantity: 3, refundableQuantity: 0, isGiftCard: false, requiresShipping: true, originalUnitPrice: "0", discountedTotal: "0", currencyCode: "INR", productType: null, vendor: null, tags: [], ...overrides });
test("normal unrefunded lines remain reviewable when all quantity is still refundable", () => assert.deepEqual(decideReviewCandidateLine(line({ quantity: 3, currentQuantity: 3, refundableQuantity: 3 })), { reviewable: true, reason: "REVIEWABLE" }));
test("delivered lines remain reviewable after full or partial refunds", () => {
  assert.equal(decideReviewCandidateLine(line({ quantity: 1, currentQuantity: 1, refundableQuantity: 0 })).reason, "REVIEWABLE");
  assert.equal(decideReviewCandidateLine(line({ quantity: 3, currentQuantity: 2, refundableQuantity: 1 })).reason, "REVIEWABLE");
  assert.equal(decideReviewCandidateLine(line({ quantity: 3, currentQuantity: 3, refundableQuantity: 2 })).reason, "REVIEWABLE");
});
test("removed, gift card and unidentified product lines remain excluded", () => { assert.equal(decideReviewCandidateLine(line({ currentQuantity: 0 })).reason, "CANCELED_OR_REMOVED"); assert.equal(decideReviewCandidateLine(line({ isGiftCard: true })).reason, "GIFT_CARD"); assert.equal(decideReviewCandidateLine(line({ shopifyProductId: null })).reason, "MISSING_PRODUCT_ID"); });
test("snapshot normalizers reject unsafe images and default variant labels", () => { assert.equal(normalizeHttpsImageUrl("javascript:alert(1)"), null); assert.equal(normalizeHttpsImageUrl("https://cdn.example/a.jpg"), "https://cdn.example/a.jpg"); assert.equal(normalizeVariantTitle(" Default Title "), null); });
