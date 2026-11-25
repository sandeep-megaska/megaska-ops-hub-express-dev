import { getPool, withTransaction } from "../db.ts";
import { ensureStore } from "../store.ts";
import { rebuildCollections, importCollections, validateCollectionsFile } from "../collections/store.ts";
import { parseShopifyProductsCsv } from "./shopify-products.ts";
import { applyProducts, type ProductImportMode } from "./apply-products.ts";
import { applyRedirects, parseRedirectsCsv } from "./redirects.ts";

// Entry points for the admin page and CLI. Each import is one transaction
// (all or nothing) and leaves a row in import_runs.

type Outcome<T> = { ok: true; stats: T; warnings: string[] } | { ok: false; error: string; warnings: string[] };

async function recorded<T extends object>(
  kind: string,
  fileName: string | null,
  work: (storeId: string) => Promise<{ stats: T; warnings: string[] }>,
): Promise<Outcome<T>> {
  const storeId = await ensureStore();
  const run = await getPool().query<{ id: string }>(
    `insert into import_runs (store_id, kind, file_name) values ($1, $2, $3) returning id`,
    [storeId, kind, fileName],
  );
  const runId = run.rows[0].id;
  try {
    const { stats, warnings } = await work(storeId);
    await getPool().query(
      `update import_runs set status = 'succeeded', finished_at = now(), stats = $2, warnings = $3 where id = $1`,
      [runId, JSON.stringify(stats), JSON.stringify(warnings.slice(0, 500))],
    );
    return { ok: true, stats, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await getPool().query(
      `update import_runs set status = 'failed', finished_at = now(), error = $2 where id = $1`,
      [runId, message],
    );
    return { ok: false, error: message, warnings: [] };
  }
}

export function importProductsCsv(text: string, options: { mode: ProductImportMode; fileName?: string }) {
  return recorded("products_csv", options.fileName ?? null, async (storeId) => {
    const { products, warnings } = parseShopifyProductsCsv(text);
    if (!products.length) throw new Error("No products found in the file");
    const stats = await withTransaction(async (db) => {
      const s = await applyProducts(db, storeId, products, options.mode);
      const c = await rebuildCollections(db, storeId);
      return { ...s, products: products.length, collectionMemberships: c.memberships };
    });
    return { stats, warnings };
  });
}

export function importRedirectsCsv(text: string, fileName?: string) {
  return recorded("redirects_csv", fileName ?? null, async (storeId) => {
    const { redirects, warnings } = parseRedirectsCsv(text);
    const count = await withTransaction((db) => applyRedirects(db, storeId, redirects));
    return { stats: { redirects: count }, warnings };
  });
}

export function importCollectionsJson(json: unknown, fileName?: string) {
  return recorded("collections", fileName ?? null, async (storeId) => {
    const file = validateCollectionsFile(json);
    const stats = await withTransaction((db) => importCollections(db, storeId, file));
    return { stats, warnings: [] };
  });
}
