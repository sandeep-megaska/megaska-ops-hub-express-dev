import { getPool, type Queryable } from "./db.ts";
import { env } from "./env.ts";

let cachedStoreId: string | undefined;

/** The tenant row for this deployment, created on first use. */
export async function ensureStore(db: Queryable = getPool()): Promise<string> {
  if (cachedStoreId) return cachedStoreId;
  const { rows } = await db.query<{ id: string }>(
    `insert into stores (slug, name) values ($1, $2)
     on conflict (slug) do update set updated_at = stores.updated_at
     returning id`,
    [env.storeSlug(), env.storeName()],
  );
  cachedStoreId = rows[0].id;
  return cachedStoreId;
}

/** Read-only lookup for the storefront pages. */
export async function getStoreId(db: Queryable = getPool()): Promise<string | null> {
  if (cachedStoreId) return cachedStoreId;
  const { rows } = await db.query<{ id: string }>(`select id from stores where slug = $1`, [env.storeSlug()]);
  if (rows[0]) cachedStoreId = rows[0].id;
  return rows[0]?.id ?? null;
}

/** For tests that switch stores within one process. */
export function resetStoreCache(): void {
  cachedStoreId = undefined;
}
