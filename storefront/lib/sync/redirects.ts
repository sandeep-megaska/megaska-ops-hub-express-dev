import { withTransaction } from "../db.ts";
import { adminGraphql } from "../shopify/admin.ts";
import { legacyId } from "../shopify/map.ts";
import { URL_REDIRECTS_PAGE_QUERY } from "../shopify/queries.ts";
import type { Connection } from "../shopify/types.ts";

type Redirect = { id: string; path: string; target: string };

/** Replace our copy of Shopify's URL redirects (needs read_online_store_navigation). */
export async function syncRedirects(storeId: string): Promise<number> {
  const all: Redirect[] = [];
  let after: string | null = null;
  for (;;) {
    const data: { urlRedirects: Connection<Redirect> } = await adminGraphql(URL_REDIRECTS_PAGE_QUERY, { after });
    all.push(...data.urlRedirects.nodes);
    if (!data.urlRedirects.pageInfo?.hasNextPage) break;
    after = data.urlRedirects.pageInfo.endCursor;
  }

  const rows = all.map((r) => ({ shopify_id: legacyId(r.id), path: normalizePath(r.path), target: r.target }));
  await withTransaction(async (db) => {
    await db.query(`delete from url_redirects where store_id = $1`, [storeId]);
    await db.query(
      `insert into url_redirects (store_id, shopify_id, path, target)
       select $1, r.shopify_id, r.path, r.target
       from jsonb_to_recordset($2::jsonb) as r(shopify_id bigint, path text, target text)
       on conflict (store_id, path) do update set target = excluded.target, shopify_id = excluded.shopify_id`,
      [storeId, JSON.stringify(rows)],
    );
  });
  return rows.length;
}

/** Shopify matches redirect paths case-insensitively and without a trailing slash. */
export function normalizePath(path: string): string {
  let p = path.trim().toLowerCase();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}
