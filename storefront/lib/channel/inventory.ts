import { withTransaction, getPool } from "../db.ts";
import { productTag } from "../catalog/tags.ts";

export const MAX_ITEMS_PER_REQUEST = 1000;

export type StockUpdate = { sku: string; quantity: number; updatedAt?: string };
export type StockOutcome = "updated" | "unchanged" | "stale" | "unknown_sku";
export type StockResult = { sku: string; outcome: StockOutcome; quantity?: number };

export class ValidationError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

/** Check and normalise a request body: {"items": [{"sku", "quantity", "updated_at"?}]}. */
export function parseStockUpdates(body: unknown): StockUpdate[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) throw new ValidationError('Body must be {"items": [{"sku": "...", "quantity": 0}]}');
  if (items.length === 0) throw new ValidationError("items is empty");
  if (items.length > MAX_ITEMS_PER_REQUEST) {
    throw new ValidationError(`At most ${MAX_ITEMS_PER_REQUEST} items per request; got ${items.length}`);
  }
  const problems: string[] = [];
  const bySku = new Map<string, StockUpdate>();
  items.forEach((raw, i) => {
    const item = raw as { sku?: unknown; quantity?: unknown; updated_at?: unknown };
    const sku = typeof item.sku === "string" ? item.sku.trim() : "";
    if (!sku) return problems.push(`items[${i}]: sku is required`);
    if (typeof item.quantity !== "number" || !Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > 1_000_000) {
      return problems.push(`items[${i}] (${sku}): quantity must be a whole number from 0 to 1000000`);
    }
    let updatedAt: string | undefined;
    if (item.updated_at !== undefined && item.updated_at !== null) {
      const d = typeof item.updated_at === "string" ? new Date(item.updated_at) : new Date(NaN);
      if (Number.isNaN(d.getTime())) return problems.push(`items[${i}] (${sku}): updated_at must be an ISO 8601 timestamp`);
      updatedAt = d.toISOString();
    }
    // Same SKU twice in one request: the last one wins, as if sent in order.
    bySku.set(sku.toLowerCase(), { sku, quantity: item.quantity, updatedAt });
  });
  if (problems.length) throw new ValidationError("Some items are invalid; nothing was applied", problems);
  return [...bySku.values()];
}

/**
 * Set absolute stock levels by SKU. Absolute (not +/-) so a retried request
 * is harmless. A reading older than the one we hold (by updated_at, or by
 * arrival time when the sender gives none) is ignored as "stale".
 * Returns per-SKU outcomes and the cache tags to refresh.
 */
export async function applyStockUpdates(
  storeId: string,
  updates: StockUpdate[],
  source: { clientName: string; requestId: string | null },
): Promise<{ results: StockResult[]; tags: string[] }> {
  const receivedAt = new Date().toISOString();
  const apiSource = `api:${source.clientName}`;
  return withTransaction(async (db) => {
    // Rules, per SKU:
    //   unknown_sku  no variant has this SKU
    //   stale        an API client already gave a reading at least as new
    //   updated      quantity changed (or the first API reading replaces CSV stock)
    //   unchanged    same quantity; the reading time still moves forward
    const { rows } = await db.query<{
      sku: string; quantity: number; previous: number | null; handle: string | null; reading_at: string; outcome: StockOutcome;
    }>(
      `with input as (
         select e->>'sku' as sku, (e->>'quantity')::int as quantity,
                coalesce((e->>'updated_at')::timestamptz, $3::timestamptz) as reading_at, ord
         from jsonb_array_elements($2::jsonb) with ordinality as x(e, ord)
       ),
       target as (
         select i.*, v.id as variant_id, v.inventory_quantity as previous, p.handle,
                (v.inventory_source is null or v.inventory_source not like 'api:%') as first_api_reading
         from input i
         left join product_variants v on v.store_id = $1 and lower(v.sku) = lower(i.sku)
         left join products p on p.id = v.product_id
       ),
       applied as (
         update product_variants v
         set inventory_quantity = t.quantity, inventory_updated_at = t.reading_at, inventory_source = $4,
             updated_at = case when v.inventory_quantity <> t.quantity then now() else v.updated_at end
         from target t
         -- Checked on the locked row, so two concurrent pushes can't let an older reading win.
         where v.id = t.variant_id
           and not (coalesce(v.inventory_source, '') like 'api:%' and v.inventory_updated_at >= t.reading_at)
         returning v.id
       )
       select t.sku, t.quantity, t.previous, t.handle, t.reading_at,
              case
                when t.variant_id is null then 'unknown_sku'
                when t.variant_id not in (select id from applied) then 'stale'
                when t.previous <> t.quantity or t.first_api_reading then 'updated'
                else 'unchanged'
              end as outcome
       from target t
       order by t.ord`,
      [
        storeId,
        JSON.stringify(updates.map((u) => ({ sku: u.sku, quantity: u.quantity, updated_at: u.updatedAt ?? null }))),
        receivedAt,
        apiSource,
      ],
    );

    await db.query(
      `insert into inventory_log (store_id, sku, quantity, previous, outcome, source, request_id, reading_at)
       select $1, l.sku, l.quantity, l.previous, l.outcome, $3, $4, l.reading_at
       from jsonb_to_recordset($2::jsonb) as l(sku text, quantity int, previous int, outcome text, reading_at timestamptz)`,
      [storeId, JSON.stringify(rows), source.clientName, source.requestId],
    );

    const tags = [...new Set(rows.filter((r) => r.outcome === "updated" && r.handle).map((r) => productTag(r.handle!)))];
    return {
      results: rows.map((r): StockResult =>
        r.outcome === "unknown_sku"
          ? { sku: r.sku, outcome: r.outcome }
          : { sku: r.sku, outcome: r.outcome, quantity: r.outcome === "stale" ? (r.previous ?? 0) : r.quantity },
      ),
      tags,
    };
  });
}

/** Current stock for some SKUs (or all, paginated by SKU). */
export async function readStock(storeId: string, options: { skus?: string[]; after?: string; limit: number }) {
  const { rows } = await getPool().query<{ sku: string; quantity: number; updated_at: string | null; source: string | null }>(
    `select v.sku, v.inventory_quantity as quantity,
            case when v.inventory_updated_at = '-infinity' then null else v.inventory_updated_at end as updated_at,
            v.inventory_source as source
     from product_variants v
     where v.store_id = $1 and v.sku is not null
       and ($2::text[] is null or lower(v.sku) = any(select lower(x) from unnest($2::text[]) x))
       and ($3::text is null or v.sku > $3)
     order by v.sku
     limit $4`,
    [storeId, options.skus ?? null, options.after ?? null, options.limit],
  );
  return rows;
}
