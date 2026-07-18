/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { assertDevelopmentOrderImportEnabled, importShopifyOrderForDevelopment } from "./import-shopify-order.ts";
import { normalizeShopifyOrderIdentifier, syncCanonicalShopifyOrder } from "../orders/shopify-order-sync.ts";

test("guard requires its exact flag and independently rejects both production signals", () => {
  assert.throws(() => assertDevelopmentOrderImportEnabled({}), /DEV_HELPER_DISABLED/);
  assert.throws(() => assertDevelopmentOrderImportEnabled({ LOOPDESK_DEV_ORDER_IMPORT_HELPER_ENABLED: "true", VERCEL_ENV: "production" }), /DEV_HELPER_NOT_ALLOWED/);
  assert.throws(() => assertDevelopmentOrderImportEnabled({ LOOPDESK_DEV_ORDER_IMPORT_HELPER_ENABLED: "true", LOOPDESK_ENV: "production", VERCEL_ENV: "preview" }), /DEV_HELPER_NOT_ALLOWED/);
  assert.doesNotThrow(() => assertDevelopmentOrderImportEnabled({ LOOPDESK_DEV_ORDER_IMPORT_HELPER_ENABLED: "true", VERCEL_ENV: "preview" }));
});

test("accepts only a numeric ID or canonical Admin GraphQL order GID", () => {
  assert.equal(normalizeShopifyOrderIdentifier("123"), "gid://shopify/Order/123");
  assert.equal(normalizeShopifyOrderIdentifier("gid://shopify/Order/123"), "gid://shopify/Order/123");
  for (const value of ["#123", "gid://shopify/Order/nope", "123,124", ""]) assert.throws(() => normalizeShopifyOrderIdentifier(value), /INVALID_ORDER_ID/);
});

const source = {
  shopifyOrderId: "gid://shopify/Order/123", shopifyOrderName: "#123", createdAt: "2026-07-17T10:00:00Z", processedAt: "2026-07-17T10:01:00Z", cancelledAt: null,
  displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", deliveredAt: "2026-07-18T10:00:00Z", customerId: "gid://shopify/Customer/9",
  lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/7", shopifyProductId: "gid://shopify/Product/8", shopifyVariantId: "gid://shopify/ProductVariant/10", title: "Tea", productTitle: "Tea", variantTitle: "Default Title", productHandle: "tea", productImageUrl: "https://example.test/tea.jpg", sku: "TEA", quantity: 1, currentQuantity: 1, fulfillableQuantity: 0, refundableQuantity: 1, isGiftCard: false, requiresShipping: true, originalUnitPrice: "10.00", discountedTotal: "10.00", currencyCode: "INR", productType: "Tea", vendor: "Megaska", tags: [] }],
};

function harness() {
  const customers: any[] = [], orders: any[] = [], lines: any[] = [];
  const db = {
    customerProfile: {
      findFirst: async ({ where }: any) => customers.find((row) => row.shopId === where.shopId && row.shopifyCustomerId === where.shopifyCustomerId) ?? null,
      create: async ({ data }: any) => { const row = { id: `customer-${customers.length + 1}`, ...data }; customers.push(row); return row; },
    },
    megaskaOrder: {
      findFirst: async ({ where }: any) => orders.find((row) => row.shopId === where.shopId && (row.shopifyOrderId === where.OR[0].shopifyOrderId || row.shopifyOrderName === where.OR[1].shopifyOrderName)) ?? null,
      create: async ({ data }: any) => { const row = { id: `order-${orders.length + 1}`, deliveredAt: null, ...data }; orders.push(row); return row; },
      update: async ({ where, data }: any) => { const row = orders.find((item) => item.id === where.id); Object.assign(row, data); return row; },
    },
  };
  const deps = { db, fetchOrder: async () => source, createOrderLine: async (input: any) => { const existing = lines.find((line) => line.shopId === input.shopId && line.shopifyOrderId === input.shopifyOrderId && line.shopifyLineItemId === input.shopifyLineItemId); if (existing) return existing; const row = { id: `line-${lines.length + 1}`, ...input }; lines.push(row); return row; } };
  return { customers, orders, lines, deps };
}

test("sync is tenant scoped, idempotent, links the customer, creates lines, and does not synthesize delivery", async () => {
  const state = harness();
  const first = await syncCanonicalShopifyOrder({ shopId: "shop-a", shopDomain: "a.myshopify.com", orderIdentifier: "123" }, state.deps as any);
  const second = await syncCanonicalShopifyOrder({ shopId: "shop-a", shopDomain: "a.myshopify.com", orderIdentifier: "123" }, state.deps as any);
  const otherTenant = await syncCanonicalShopifyOrder({ shopId: "shop-b", shopDomain: "b.myshopify.com", orderIdentifier: "123" }, state.deps as any);
  assert.equal(first.id, second.id);
  assert.notEqual(first.id, otherTenant.id);
  assert.equal(state.orders.length, 2);
  assert.equal(state.customers.length, 2);
  assert.equal(state.lines.length, 2);
  assert.equal(first.customerProfileId, state.customers[0].id);
  assert.equal(state.lines[0].customerProfileId, first.customerProfileId);
  assert.equal(state.lines[0].megaskaOrderId, first.id);
  assert.equal(first.deliveredAt, null);
  assert.notEqual(first.status, "DELIVERED");
  assert.equal(first.metadata.shopifyDeliveredAt, source.deliveredAt);
});

test("development import creates one candidate when refundable quantity equals quantity and preserves delivery on rerun", async () => {
  const state = harness();
  const sync = (input: { shopId: string; shopDomain: string; orderIdentifier: string }) => syncCanonicalShopifyOrder(input, state.deps as any);
  const input = { shopId: "shop-a", shopDomain: "a.myshopify.com", orderIdentifier: "123" };
  const first = await importShopifyOrderForDevelopment(input, { env: { LOOPDESK_DEV_ORDER_IMPORT_HELPER_ENABLED: "true" }, sync });
  assert.equal(state.lines.length, 1);

  first.status = "DELIVERED";
  first.deliveredAt = new Date("2026-07-18T10:00:00Z");
  const second = await importShopifyOrderForDevelopment(input, { env: { LOOPDESK_DEV_ORDER_IMPORT_HELPER_ENABLED: "true" }, sync });

  assert.equal(state.lines.length, 1);
  assert.equal(second.status, "DELIVERED");
  assert.equal(second.deliveredAt?.toISOString(), "2026-07-18T10:00:00.000Z");
});
