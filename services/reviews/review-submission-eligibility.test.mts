import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReviewSubmissionEligibility, type ReviewSubmissionEligibilityDependencies } from "./review-submission-eligibility.ts";

const input = { shopId: "shop", customerProfileId: "customer", orderId: "order", orderLineId: "line", productId: "product", variantId: "variant" };
const deliveredAt = new Date("2026-01-01T00:00:00.000Z");
function deps(overrides: Partial<ReviewSubmissionEligibilityDependencies> = {}): ReviewSubmissionEligibilityDependencies {
  return {
    getReviewSettings: async () => ({ reviewsEnabled: true, automaticRequestsEnabled: false, storefrontReviewsEnabled: false } as never),
    findCustomer: async () => ({ id: "customer", shopId: "shop" }),
    findOrder: async () => ({ id: "canonical-order", shopId: "shop", customerProfileId: "customer", shopifyOrderId: "shopify-order", deliveredAt, status: "DELIVERED" }),
    findOrderLine: async () => ({ id: "request", shopId: "shop", customerProfileId: "customer", megaskaOrderId: "canonical-order", shopifyOrderId: "shopify-order", shopifyLineItemId: "canonical-line", shopifyProductId: "canonical-product", shopifyVariantId: "canonical-variant" }),
    findExistingReview: async () => null,
    isDelivered: (order) => Boolean(order.deliveredAt) && order.status === "DELIVERED",
    ...overrides,
  };
}
function reason(result: Awaited<ReturnType<typeof evaluateReviewSubmissionEligibility>>) { assert.equal(result.eligible, false); return result.reason; }
const canonicalInput = { ...input, orderId: "browser-order", orderLineId: "browser-line", productId: "canonical-product", variantId: undefined };

test("delivered owned purchased line is eligible and returns canonical identifiers", async () => {
  const result = await evaluateReviewSubmissionEligibility(canonicalInput, deps());
  assert.deepEqual(result, { eligible: true, verifiedPurchase: true, shopId: "shop", customerProfileId: "customer", orderId: "canonical-order", orderLineId: "canonical-line", productId: "canonical-product", variantId: "canonical-variant" });
});

test("reviewsEnabled gates direct submission but request/display flags do not", async () => {
  assert.equal((await evaluateReviewSubmissionEligibility(canonicalInput, deps({ getReviewSettings: async () => ({ reviewsEnabled: false, automaticRequestsEnabled: true, storefrontReviewsEnabled: true } as never) }))).eligible && "", false);
  assert.equal((await evaluateReviewSubmissionEligibility(canonicalInput, deps())).eligible, true);
});

test("tenant-scoped customer and order ownership are required", async () => {
  assert.equal(reason(await evaluateReviewSubmissionEligibility(canonicalInput, deps({ findCustomer: async () => null }))), "CUSTOMER_NOT_FOUND");
  assert.equal(reason(await evaluateReviewSubmissionEligibility(canonicalInput, deps({ findCustomer: async () => ({ id: "customer", shopId: "other" }) }))), "CUSTOMER_NOT_FOUND");
  assert.equal(reason(await evaluateReviewSubmissionEligibility(canonicalInput, deps({ findOrder: async () => null }))), "ORDER_NOT_FOUND");
  assert.equal(reason(await evaluateReviewSubmissionEligibility(canonicalInput, deps({ findOrder: async () => ({ id: "order", shopId: "other", customerProfileId: "customer", deliveredAt, status: "DELIVERED" }) }))), "ORDER_NOT_FOUND");
  assert.equal(reason(await evaluateReviewSubmissionEligibility(canonicalInput, deps({ findOrder: async () => ({ id: "order", shopId: "shop", customerProfileId: "other", deliveredAt, status: "DELIVERED" }) }))), "ORDER_NOT_OWNED");
});

test("only canonical delivered orders are eligible", async () => {
  for (const status of ["ORDER_CONFIRMED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "CANCELLED", "RETURN_REQUESTED", "RTO_DELIVERED", "DELIVERY_FAILED"])
    assert.equal(reason(await evaluateReviewSubmissionEligibility(canonicalInput, deps({ findOrder: async () => ({ id: "canonical-order", shopId: "shop", customerProfileId: "customer", deliveredAt: status === "ORDER_CONFIRMED" ? null : deliveredAt, status }) }))), "ORDER_NOT_DELIVERED");
  assert.equal((await evaluateReviewSubmissionEligibility(canonicalInput, deps()).then((r) => r.eligible)), true);
});

test("line, product, variant, and duplicate checks protect purchased association", async () => {
  assert.equal(reason(await evaluateReviewSubmissionEligibility(canonicalInput, deps({ findOrderLine: async () => null }))), "ORDER_LINE_NOT_FOUND");
  assert.equal(reason(await evaluateReviewSubmissionEligibility(canonicalInput, deps({ findOrderLine: async () => ({ id: "request", shopId: "shop", customerProfileId: "customer", megaskaOrderId: "other", shopifyOrderId: "shopify-order", shopifyLineItemId: "canonical-line", shopifyProductId: "canonical-product", shopifyVariantId: "canonical-variant" }) }))), "ORDER_LINE_NOT_FOUND");
  assert.equal(reason(await evaluateReviewSubmissionEligibility({ ...canonicalInput, productId: "other" }, deps())), "PRODUCT_MISMATCH");
  assert.equal(reason(await evaluateReviewSubmissionEligibility({ ...canonicalInput, variantId: "other" }, deps())), "VARIANT_MISMATCH");
  assert.equal((await evaluateReviewSubmissionEligibility({ ...canonicalInput, variantId: "legacy" }, deps({ findOrderLine: async () => ({ id: "request", shopId: "shop", customerProfileId: "customer", megaskaOrderId: "canonical-order", shopifyOrderId: "shopify-order", shopifyLineItemId: "canonical-line", shopifyProductId: "canonical-product", shopifyVariantId: null }) })).then((r) => r.eligible)), true);
  for (const status of ["PENDING_MODERATION", "PUBLISHED", "REJECTED"])
    assert.equal(reason(await evaluateReviewSubmissionEligibility(canonicalInput, deps({ findExistingReview: async () => ({ id: "review", status }) }))), "ALREADY_REVIEWED");
});
