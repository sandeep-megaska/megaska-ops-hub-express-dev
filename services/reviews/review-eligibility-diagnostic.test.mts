import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseOrderDeliveryForReview } from "../orders/canonical-delivery.ts";
import { normalizeShopifyProductId, normalizeShopifyVariantId } from "./shopify-product-id.ts";
import { resolveReviewEligibility } from "./review-eligible-purchases.ts";

test("Shopify product and variant IDs normalize within, but not across, resource types", () => {
  assert.equal(normalizeShopifyProductId("gid://shopify/Product/123"), "123");
  assert.equal(normalizeShopifyVariantId("gid://shopify/ProductVariant/456"), "456");
  assert.equal(normalizeShopifyProductId("gid://shopify/ProductVariant/123"), null);
  assert.equal(normalizeShopifyVariantId("gid://shopify/Product/456"), null);
});

test("delivery diagnostics distinguish missing timestamps, unknown states, and undelivered orders", () => {
  assert.deepEqual(diagnoseOrderDeliveryForReview({ status: "DELIVERED", deliveredAt: null }), { delivered: false, code: "DELIVERED_AT_MISSING" });
  assert.deepEqual(diagnoseOrderDeliveryForReview({ status: "mystery", deliveredAt: new Date() }), { delivered: false, code: "DELIVERY_STATE_UNRECOGNIZED" });
  assert.deepEqual(diagnoseOrderDeliveryForReview({ status: "IN_TRANSIT", deliveredAt: null }), { delivered: false, code: "ORDER_NOT_DELIVERED" });
  assert.equal(diagnoseOrderDeliveryForReview({ status: "delivered", deliveredAt: new Date() }).delivered, true);
});

test("canonical merged profile resolves a delivered purchase and reports an existing review", async () => {
  const deliveredAt = new Date("2026-07-18T00:00:00Z");
  const row = { id: "request", customerProfileId: "target", megaskaOrderId: "order", shopifyLineItemId: "line", shopifyProductId: "gid://shopify/Product/123", shopifyVariantId: "gid://shopify/ProductVariant/456", productTitleSnapshot: "Tea", variantTitleSnapshot: null, productImageUrlSnapshot: null, shopifyOrderName: "#1", deliveredAtSnapshot: deliveredAt, review: { id: "review", customerProfileId: "target" }, megaskaOrder: { id: "order", shopId: "shop", customerProfileId: "target", shopifyOrderName: "#1", deliveredAt, status: "DELIVERED" } };
  const db = {
    customerProfile: { findFirst: async (args: unknown) => { const { where } = args as { where: { id: string } }; return ["source", "target"].includes(where.id) ? { id: where.id } : null; } },
    customerIdentityMerge: { findFirst: async () => ({ targetCustomerProfileId: "target" }) },
    reviewRequest: { findMany: async (args: unknown) => { const { where } = args as { where: { customerProfileId?: string } }; return !where.customerProfileId || where.customerProfileId === "target" ? [row] : []; } },
  } as never;
  const result = await resolveReviewEligibility({ shopId: "shop", customerProfileId: "source", productId: "123" }, db);
  assert.equal(result.diagnostics.eligible, true);
  assert.equal(result.diagnostics.code, "ELIGIBLE");
  assert.equal(result.diagnostics.diagnosticContext.existingReviewFound, true);
  assert.equal(result.purchases[0].existingReviewFound, true);
});
