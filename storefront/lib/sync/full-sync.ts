import { getPool } from "../db.ts";
import { adminGraphql } from "../shopify/admin.ts";
import { legacyId, mapCollection, mapProduct } from "../shopify/map.ts";
import { COLLECTIONS_PAGE_QUERY, PRODUCT_IDS_QUERY } from "../shopify/queries.ts";
import type { Connection, ShopifyCollection } from "../shopify/types.ts";
import { ensureStore, finishSyncRun, startSyncRun } from "./store.ts";
import { fetchProduct, upsertProduct } from "./products.ts";
import { fetchCollectionProductIds, upsertCollection } from "./collections.ts";
import { syncRedirects } from "./redirects.ts";

export type FullSyncStats = {
  products: number;
  productsRemoved: number;
  collections: number;
  collectionsRemoved: number;
  redirects: number | null;
  redirectsError?: string;
  durationMs: number;
};

/**
 * Copy the whole catalog from Shopify and remove what Shopify no longer has.
 * Runs on first setup and nightly as a safety net for missed webhooks.
 */
export async function runFullSync(options: { concurrency?: number; log?: (msg: string) => void } = {}): Promise<FullSyncStats> {
  const log = options.log ?? (() => {});
  const concurrency = options.concurrency ?? 4;
  const started = Date.now();
  const storeId = await ensureStore();
  const runId = await startSyncRun(storeId, "full");

  try {
    // 1. Products. Collections come second so memberships can point at them.
    const productIds: string[] = [];
    for (let after: string | null = null; ;) {
      const data: { products: Connection<{ id: string }> } = await adminGraphql(PRODUCT_IDS_QUERY, { after });
      productIds.push(...data.products.nodes.map((n) => legacyId(n.id)));
      if (!data.products.pageInfo?.hasNextPage) break;
      after = data.products.pageInfo.endCursor;
    }
    log(`Found ${productIds.length} products in Shopify`);

    let done = 0;
    const seenProducts: string[] = [];
    await runPool(productIds, concurrency, async (id) => {
      const fetchedAt = new Date();
      const product = await fetchProduct(id);
      if (product) {
        await upsertProduct(storeId, mapProduct(product), fetchedAt);
        seenProducts.push(id);
      }
      done++;
      if (done % 25 === 0 || done === productIds.length) log(`Products: ${done}/${productIds.length}`);
    });
    const productsRemoved = await getPool().query(
      `delete from products where store_id = $1 and not (shopify_id = any($2::bigint[]))`,
      [storeId, seenProducts],
    );

    // 2. Collections and their product order.
    const collections: ShopifyCollection[] = [];
    for (let after: string | null = null; ;) {
      const data: { collections: Connection<ShopifyCollection> } = await adminGraphql(COLLECTIONS_PAGE_QUERY, { after });
      collections.push(...data.collections.nodes);
      if (!data.collections.pageInfo?.hasNextPage) break;
      after = data.collections.pageInfo.endCursor;
    }
    log(`Found ${collections.length} collections in Shopify`);
    await runPool(collections, concurrency, async (c) => {
      const id = legacyId(c.id);
      await upsertCollection(storeId, mapCollection(c), await fetchCollectionProductIds(id));
    });
    const collectionsRemoved = await getPool().query(
      `delete from collections where store_id = $1 and not (shopify_id = any($2::bigint[]))`,
      [storeId, collections.map((c) => legacyId(c.id))],
    );

    // 3. Redirects. Optional: the app may not have the navigation scope yet.
    let redirects: number | null = null;
    let redirectsError: string | undefined;
    try {
      redirects = await syncRedirects(storeId);
      log(`Redirects: ${redirects}`);
    } catch (error) {
      redirectsError = error instanceof Error ? error.message : String(error);
      log(`Redirects skipped: ${redirectsError}`);
    }

    const stats: FullSyncStats = {
      products: seenProducts.length,
      productsRemoved: productsRemoved.rowCount ?? 0,
      collections: collections.length,
      collectionsRemoved: collectionsRemoved.rowCount ?? 0,
      redirects,
      ...(redirectsError ? { redirectsError } : {}),
      durationMs: Date.now() - started,
    };
    await finishSyncRun(runId, { stats });
    return stats;
  } catch (error) {
    await finishSyncRun(runId, { error, stats: { durationMs: Date.now() - started } });
    throw error;
  }
}

/** Run `worker` over `items` with at most `limit` in flight. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}
