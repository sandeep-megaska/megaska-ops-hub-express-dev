import { getPool, type Queryable } from "../db.ts";
import { env } from "../env.ts";

let cachedStoreId: string | undefined;

/** The tenant row for this deployment, created on first use. */
export async function ensureStore(db: Queryable = getPool()): Promise<string> {
  if (cachedStoreId) return cachedStoreId;
  const { rows } = await db.query<{ id: string }>(
    `insert into stores (slug, name, shopify_domain)
     values ($1, $2, $3)
     on conflict (slug) do update set shopify_domain = excluded.shopify_domain, updated_at = now()
     returning id`,
    [env.storeSlug(), env.storeName(), env.shopifyStoreDomain()],
  );
  cachedStoreId = rows[0].id;
  return cachedStoreId;
}

/** Read-only lookup for the storefront pages (never needs Shopify settings). */
export async function getStoreId(db: Queryable = getPool()): Promise<string | null> {
  if (cachedStoreId) return cachedStoreId;
  const { rows } = await db.query<{ id: string }>(`select id from stores where slug = $1`, [env.storeSlug()]);
  if (rows[0]) cachedStoreId = rows[0].id;
  return rows[0]?.id ?? null;
}

export async function startSyncRun(storeId: string, kind: string): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into sync_runs (store_id, kind) values ($1, $2) returning id`,
    [storeId, kind],
  );
  return rows[0].id;
}

export async function finishSyncRun(runId: string, outcome: { stats?: object; error?: unknown }): Promise<void> {
  const error = outcome.error === undefined ? null : outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
  await getPool().query(
    `update sync_runs set status = $2, finished_at = now(), stats = $3, error = $4 where id = $1`,
    [runId, error ? "failed" : "succeeded", JSON.stringify(outcome.stats ?? {}), error],
  );
}
