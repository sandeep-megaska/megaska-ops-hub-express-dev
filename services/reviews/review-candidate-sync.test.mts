import assert from "node:assert/strict";
import test from "node:test";
import { customerIdsDiffer, enrichExistingReviewRequestSnapshots } from "./review-candidate-sync.ts";
const line = { shopifyLineItemId: "line", shopifyProductId: "product", shopifyVariantId: "variant", title: "Line", productTitle: "Product", variantTitle: "Blue", productHandle: "product", productImageUrl: "https://cdn.example/product.jpg", sku: null, quantity: 1, currentQuantity: 1, fulfillableQuantity: 1, refundableQuantity: 0, isGiftCard: false, requiresShipping: true, originalUnitPrice: null, discountedTotal: null, currencyCode: null, productType: null, vendor: null, tags: [] };
test("enrichment fills incomplete snapshots but preserves historical values", async () => { let update: unknown; const result = await enrichExistingReviewRequestSnapshots({ reviewRequest: { id: "request", shopId: "shop", customerProfileId: "customer", megaskaOrderId: "order", shopifyOrderId: "order-gid", shopifyLineItemId: "line", shopifyProductId: "product", shopifyVariantId: null, shopifyOrderName: null, productTitleSnapshot: "Purchased title", variantTitleSnapshot: null, productHandleSnapshot: null, productImageUrlSnapshot: null, orderCreatedAt: null, deliveredAtSnapshot: null, status: "PENDING_ELIGIBILITY" }, sourceLine: line, sourceOrder: { shopifyOrderId: "order-gid", shopifyOrderName: "#1", createdAt: "2026-01-01T00:00:00.000Z", processedAt: null, cancelledAt: null, displayFinancialStatus: null, displayFulfillmentStatus: null, deliveredAt: null, customerId: null, lineItems: [line] }, canonicalDeliveredAt: new Date("2026-01-02T00:00:00.000Z") }, { reviewRequest: { update: async (args: unknown) => { update = args; return {} as never; } } } as never); assert.equal(result.enriched, true); assert.match(JSON.stringify(update), /productImageUrlSnapshot/); });

// Production regression (Nov 2026): profiles store Shopify's numeric customer id while the
// Admin API returns a Customer GID, so every order threw REVIEW_SOURCE_CUSTOMER_MISMATCH
// before eligibility ran and no review request ever became eligible.
test("the customer check treats a numeric id and its Customer GID as the same customer", () => {
  assert.equal(customerIdsDiffer("7712345678901", "gid://shopify/Customer/7712345678901"), false);
  assert.equal(customerIdsDiffer("gid://shopify/Customer/7712345678901", "7712345678901"), false);
  assert.equal(customerIdsDiffer("7712345678901", "7712345678901"), false);
  // A different customer is still a mismatch.
  assert.equal(customerIdsDiffer("7712345678901", "gid://shopify/Customer/7712345678902"), true);
  // Missing on either side: nothing to compare (guest checkout, unlinked profile).
  assert.equal(customerIdsDiffer(null, "gid://shopify/Customer/1"), false);
  assert.equal(customerIdsDiffer("1", null), false);
});
