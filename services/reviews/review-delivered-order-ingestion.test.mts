import assert from "node:assert/strict";
import test from "node:test";
import { ingestRecentlyDeliveredOrders, latestDeliveredAt, listRecentlyDeliveredShopifyOrders, selectDeliveredOrders } from "./review-delivered-order-ingestion.ts";

const now = new Date("2026-10-03T10:00:00.000Z");

test("latest delivered date wins and invalid dates are ignored", () => {
  assert.equal(latestDeliveredAt(null), null);
  assert.equal(latestDeliveredAt([{ deliveredAt: null }, { deliveredAt: "not-a-date" }]), null);
  assert.equal(latestDeliveredAt([{ deliveredAt: "2026-10-01T05:00:00Z" }, { deliveredAt: "2026-10-02T06:43:45Z" }])?.toISOString(), "2026-10-02T06:43:45.000Z");
});

test("selects only uncancelled orders delivered inside the window", () => {
  const selected = selectDeliveredOrders([
    { id: "gid://shopify/Order/1", fulfillments: [{ deliveredAt: "2026-10-02T06:43:45Z" }] },
    { id: "gid://shopify/Order/2", fulfillments: [{ deliveredAt: null }] },
    { id: "gid://shopify/Order/3", cancelledAt: "2026-10-02T00:00:00Z", fulfillments: [{ deliveredAt: "2026-10-01T00:00:00Z" }] },
    { id: "gid://shopify/Order/4", fulfillments: [{ deliveredAt: "2026-08-01T00:00:00Z" }] },
    { id: "gid://shopify/Order/5", fulfillments: [{ deliveredAt: "2026-10-05T00:00:00Z" }] },
    { id: null, fulfillments: [{ deliveredAt: "2026-10-02T00:00:00Z" }] },
  ], { now, maxAgeDays: 30 });
  assert.deepEqual(selected.map((order) => order.shopifyOrderId), ["gid://shopify/Order/1"]);
});

test("lists delivered orders across pages with an updated-at search", async () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const pages = [
    { orders: { nodes: [{ id: "gid://shopify/Order/1", fulfillments: [{ deliveredAt: "2026-10-02T00:00:00Z" }] }], pageInfo: { hasNextPage: true, endCursor: "c1" } } },
    { orders: { nodes: [{ id: "gid://shopify/Order/2", fulfillments: [{ deliveredAt: "2026-09-30T00:00:00Z" }] }], pageInfo: { hasNextPage: false, endCursor: null } } },
  ];
  const graphql = async <T,>(_query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => {
    assert.equal(options?.shopDomain, "shop.myshopify.com");
    calls.push(variables);
    return pages[calls.length - 1] as T;
  };
  const orders = await listRecentlyDeliveredShopifyOrders({ shopDomain: "shop.myshopify.com", now, maxAgeDays: 30 }, graphql);
  assert.deepEqual(orders.map((order) => order.shopifyOrderId), ["gid://shopify/Order/1", "gid://shopify/Order/2"]);
  assert.equal(calls[0]?.query, "fulfillment_status:shipped updated_at:>='2026-09-03T10:00:00.000Z'");
  assert.equal(calls[1]?.after, "c1");
});

test("ingests new deliveries through import, delivery and candidate sync", async () => {
  const steps: string[] = [];
  const summary = await ingestRecentlyDeliveredOrders({ now, maxAgeDays: 30, maxOrders: 2 }, {
    db: {
      shop: { findMany: async () => [{ id: "shop-1", shopDomain: "shop.myshopify.com" }] },
      megaskaOrder: { findMany: async () => [{ shopifyOrderId: "gid://shopify/Order/1" }] },
    },
    listDelivered: async () => [1, 2, 3, 4, 5].map((n) => ({ shopifyOrderId: `gid://shopify/Order/${n}`, deliveredAt: new Date("2026-10-02T00:00:00Z") })),
    syncOrder: (async (input: { orderIdentifier: string }) => {
      steps.push(`import:${input.orderIdentifier}`);
      if (input.orderIdentifier.endsWith("/3")) throw Object.assign(new Error("guest"), { code: "SHOPIFY_CUSTOMER_REQUIRED" });
      return { id: `mo-${input.orderIdentifier.split("/").pop()}` };
    }) as never,
    recordDelivery: (async (input: { megaskaOrderId: string; source: string; deliveredAt: Date }) => {
      steps.push(`deliver:${input.megaskaOrderId}:${input.source}`);
      return {};
    }) as never,
    syncCandidates: (async (input: { megaskaOrderId: string }) => { steps.push(`candidates:${input.megaskaOrderId}`); return {}; }) as never,
  });
  assert.deepEqual(steps, [
    "import:gid://shopify/Order/2", "deliver:mo-2:SHOPIFY_FULFILLMENT", "candidates:mo-2",
    "import:gid://shopify/Order/3",
  ]);
  assert.deepEqual(summary, { shops: 1, listed: 5, alreadyDelivered: 1, ingested: 1, skippedNoCustomer: 1, failed: 0, deferred: 2 });
});

test("a Shopify listing failure for one shop does not stop the run", async () => {
  const summary = await ingestRecentlyDeliveredOrders({ now, maxAgeDays: 30, maxOrders: 5 }, {
    db: { shop: { findMany: async () => [{ id: "s1", shopDomain: "a.myshopify.com" }] }, megaskaOrder: { findMany: async () => [] } },
    listDelivered: async () => { throw new Error("shopify down"); },
  });
  assert.equal(summary.failed, 1);
  assert.equal(summary.ingested, 0);
});
