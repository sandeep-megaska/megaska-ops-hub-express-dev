import type { recordCanonicalOrderDelivery } from "../orders/canonical-delivery.ts";
import type { syncCanonicalShopifyOrder } from "../orders/shopify-order-sync.ts";
import type { synchronizeDeliveredOrderReviewCandidatesBestEffort } from "./review-delivery-integration.ts";

// Brings delivered Shopify orders into the review pipeline. Delivery truth is the
// Shopify fulfillment `deliveredAt` (set by the courier integration), the same
// source the exchange and customer dashboard modules read.

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;

// Loaded lazily so this module stays importable in node:test.
const defaultGraphql: Graphql = async (query, variables, options) =>
  ((await import("../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options);

type OrderNode = { id?: string | null; cancelledAt?: string | null; fulfillments?: Array<{ deliveredAt?: string | null }> | null };
type OrdersPage = { orders: { nodes: OrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };

const DELIVERED_ORDERS_QUERY = `query ReviewDeliveredOrders($query: String!, $after: String) {
  orders(first: 50, after: $after, sortKey: UPDATED_AT, query: $query) {
    nodes { id cancelledAt fulfillments(first: 10) { deliveredAt } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const MAX_PAGES = 10;
const FUTURE_SKEW_MS = 10 * 60 * 1000;

export type DeliveredShopifyOrder = { shopifyOrderId: string; deliveredAt: Date };

export function latestDeliveredAt(fulfillments: OrderNode["fulfillments"]): Date | null {
  let latest: Date | null = null;
  for (const fulfillment of fulfillments ?? []) {
    const value = fulfillment?.deliveredAt ? new Date(fulfillment.deliveredAt) : null;
    if (value && !Number.isNaN(value.getTime()) && (!latest || value > latest)) latest = value;
  }
  return latest;
}

// Keeps orders that are not cancelled and were delivered inside the window.
export function selectDeliveredOrders(nodes: OrderNode[], input: { now: Date; maxAgeDays: number }): DeliveredShopifyOrder[] {
  const oldest = input.now.getTime() - input.maxAgeDays * 86_400_000;
  const newest = input.now.getTime() + FUTURE_SKEW_MS;
  const selected: DeliveredShopifyOrder[] = [];
  for (const node of nodes) {
    if (!node?.id || node.cancelledAt) continue;
    const deliveredAt = latestDeliveredAt(node.fulfillments);
    if (!deliveredAt || deliveredAt.getTime() < oldest || deliveredAt.getTime() > newest) continue;
    selected.push({ shopifyOrderId: node.id, deliveredAt });
  }
  return selected;
}

export async function listRecentlyDeliveredShopifyOrders(
  input: { shopDomain: string; now: Date; maxAgeDays: number },
  graphql: Graphql = defaultGraphql,
): Promise<DeliveredShopifyOrder[]> {
  // A delivery update changes the order, so anything delivered inside the window
  // was also updated inside it.
  const since = new Date(input.now.getTime() - input.maxAgeDays * 86_400_000).toISOString();
  const query = `fulfillment_status:shipped updated_at:>='${since}'`;
  const delivered: DeliveredShopifyOrder[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: OrdersPage = await graphql<OrdersPage>(DELIVERED_ORDERS_QUERY, { query, after }, { shopDomain: input.shopDomain });
    delivered.push(...selectDeliveredOrders(data.orders?.nodes ?? [], input));
    if (!data.orders?.pageInfo?.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return delivered;
}

type IngestionDb = {
  shop: { findMany(args: unknown): Promise<Array<{ id: string; shopDomain: string }>> };
  megaskaOrder: { findMany(args: unknown): Promise<Array<{ shopifyOrderId: string | null }>> };
};

type Dependencies = {
  db?: IngestionDb;
  listDelivered?: typeof listRecentlyDeliveredShopifyOrders;
  syncOrder?: typeof syncCanonicalShopifyOrder;
  recordDelivery?: typeof recordCanonicalOrderDelivery;
  syncCandidates?: typeof synchronizeDeliveredOrderReviewCandidatesBestEffort;
};

export type DeliveredOrderIngestionSummary = {
  shops: number;
  listed: number;
  alreadyDelivered: number;
  ingested: number;
  skippedNoCustomer: number;
  failed: number;
  deferred: number;
};

export async function ingestRecentlyDeliveredOrders(
  input: { now?: Date; maxAgeDays: number; maxOrders: number },
  dependencies: Dependencies = {},
): Promise<DeliveredOrderIngestionSummary> {
  const now = input.now ?? new Date();
  const db = dependencies.db ?? ((await import("../db/prisma.ts")).prisma as unknown as IngestionDb);
  const listDelivered = dependencies.listDelivered ?? listRecentlyDeliveredShopifyOrders;
  const syncOrder = dependencies.syncOrder ?? (await import("../orders/shopify-order-sync.ts")).syncCanonicalShopifyOrder;
  const recordDelivery = dependencies.recordDelivery ?? (await import("../orders/canonical-delivery.ts")).recordCanonicalOrderDelivery;
  const syncCandidates = dependencies.syncCandidates ?? (await import("./review-delivery-integration.ts")).synchronizeDeliveredOrderReviewCandidatesBestEffort;

  const summary: DeliveredOrderIngestionSummary = { shops: 0, listed: 0, alreadyDelivered: 0, ingested: 0, skippedNoCustomer: 0, failed: 0, deferred: 0 };
  const shops = await db.shop.findMany({
    where: { reviewSettings: { is: { reviewsEnabled: true, automaticRequestsEnabled: true } } },
    select: { id: true, shopDomain: true },
  });
  let budget = input.maxOrders;

  for (const shop of shops) {
    summary.shops += 1;
    let delivered: DeliveredShopifyOrder[];
    try {
      delivered = await listDelivered({ shopDomain: shop.shopDomain, now, maxAgeDays: input.maxAgeDays });
    } catch {
      summary.failed += 1;
      continue;
    }
    summary.listed += delivered.length;
    if (delivered.length === 0) continue;

    const known = await db.megaskaOrder.findMany({
      where: { shopId: shop.id, shopifyOrderId: { in: delivered.map((order) => order.shopifyOrderId) }, status: "DELIVERED", deliveredAt: { not: null } },
      select: { shopifyOrderId: true },
    });
    const done = new Set(known.map((order) => order.shopifyOrderId));

    for (const order of delivered) {
      if (done.has(order.shopifyOrderId)) { summary.alreadyDelivered += 1; continue; }
      if (budget <= 0) { summary.deferred += 1; continue; }
      budget -= 1;
      try {
        const canonical = await syncOrder({ shopId: shop.id, shopDomain: shop.shopDomain, orderIdentifier: order.shopifyOrderId });
        await recordDelivery({ shopId: shop.id, megaskaOrderId: canonical.id, deliveredAt: order.deliveredAt, source: "SHOPIFY_FULFILLMENT" });
        await syncCandidates({ shopId: shop.id, megaskaOrderId: canonical.id, shopDomain: shop.shopDomain });
        summary.ingested += 1;
      } catch (error) {
        // Guest checkouts have no Shopify customer and cannot be linked to a profile.
        if ((error as { code?: string } | null)?.code === "SHOPIFY_CUSTOMER_REQUIRED") summary.skippedNoCustomer += 1;
        else summary.failed += 1;
      }
    }
  }
  return summary;
}
