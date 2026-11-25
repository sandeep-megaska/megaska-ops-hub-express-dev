import type { Queryable } from "../db.ts";
import { productMatches, sortMembers, type CollectionRules, type SortOrder } from "./rules.ts";

export type CollectionDefinition = {
  handle: string;
  title: string;
  sortOrder?: SortOrder;
  descriptionHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  imageUrl?: string;
  rules?: CollectionRules;
  manualHandles?: string[];
  published?: boolean;
};

export type CollectionsFile = { bestSelling?: string[]; collections: CollectionDefinition[] };

const SORT_ORDERS: SortOrder[] = ["best_selling", "manual", "alpha_asc", "alpha_desc", "price_asc", "price_desc", "created_desc"];

export function validateCollectionsFile(input: unknown): CollectionsFile {
  const file = input as CollectionsFile;
  if (!file || !Array.isArray(file.collections)) throw new Error("Expected { collections: [...] }");
  const handles = new Set<string>();
  for (const c of file.collections) {
    if (!c.handle || !/^[a-z0-9][a-z0-9_-]*$/.test(c.handle)) throw new Error(`Bad collection handle: ${c.handle}`);
    if (handles.has(c.handle)) throw new Error(`Duplicate collection handle: ${c.handle}`);
    handles.add(c.handle);
    if (!c.title) throw new Error(`${c.handle}: title is required`);
    if (c.sortOrder && !SORT_ORDERS.includes(c.sortOrder)) throw new Error(`${c.handle}: unknown sortOrder ${c.sortOrder}`);
    if (!c.rules && !c.manualHandles) throw new Error(`${c.handle}: needs rules or manualHandles`);
  }
  return file;
}

/** Upsert collection definitions (by handle) and best-selling ranks, then rebuild. */
export async function importCollections(db: Queryable, storeId: string, file: CollectionsFile): Promise<{ collections: number; ranked: number }> {
  for (const c of file.collections) {
    await db.query(
      `insert into collections (store_id, handle, title, description_html, seo_title, seo_description, image_url,
                                sort_order, rules, manual_handles, published, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       on conflict (store_id, handle) do update set
         title = excluded.title, description_html = excluded.description_html, seo_title = excluded.seo_title,
         seo_description = excluded.seo_description, image_url = excluded.image_url, sort_order = excluded.sort_order,
         rules = excluded.rules, manual_handles = excluded.manual_handles, published = excluded.published,
         updated_at = now()`,
      [
        storeId, c.handle, c.title, c.descriptionHtml ?? "", c.seoTitle ?? null, c.seoDescription ?? null,
        c.imageUrl ?? null, c.sortOrder ?? "best_selling", c.rules ? JSON.stringify(c.rules) : null,
        c.manualHandles ?? [], c.published ?? true,
      ],
    );
  }
  if (file.bestSelling) {
    await db.query(`update stores set best_selling_handles = $2, updated_at = now() where id = $1`, [storeId, file.bestSelling]);
  }
  const { ranked } = await rebuildCollections(db, storeId);
  return { collections: file.collections.length, ranked };
}

type ProductRow = {
  id: string; handle: string; title: string; tags: string[]; product_type: string; vendor: string;
  min_price: string | null; sales_rank: number | null; created_at: Date;
  prices: string[]; compare_at_prices: string[] | null;
};

/**
 * Recompute every collection's members and their order. Cheap at catalog
 * sizes like Megaska's (hundreds of products), so it simply runs after each
 * import and stock-independent change.
 */
export async function rebuildCollections(db: Queryable, storeId: string): Promise<{ memberships: number; ranked: number }> {
  await db.query(`update products set sales_rank = null where store_id = $1 and sales_rank is not null`, [storeId]);
  const rankedRes = await db.query(
    `update products p set sales_rank = r.rank
     from stores s, unnest(s.best_selling_handles) with ordinality as r(handle, rank)
     where s.id = $1 and p.store_id = s.id and p.handle = r.handle`,
    [storeId],
  );
  const ranked = rankedRes.rowCount ?? 0;

  const products = (
    await db.query<ProductRow>(
      `select p.id, p.handle, p.title, p.tags, p.product_type, p.vendor, p.min_price::text, p.sales_rank, p.created_at,
              array(select v.price::text from product_variants v where v.product_id = p.id) as prices,
              array(select v.compare_at_price::text from product_variants v
                    where v.product_id = p.id and v.compare_at_price is not null) as compare_at_prices
       from products p where p.store_id = $1`,
      [storeId],
    )
  ).rows;
  const byHandle = new Map(products.map((p) => [p.handle, p]));
  const collections = (
    await db.query<{ id: string; sort_order: SortOrder; rules: CollectionRules | null; manual_handles: string[] }>(
      `select id, sort_order, rules, manual_handles from collections where store_id = $1`,
      [storeId],
    )
  ).rows;

  await db.query(
    `delete from collection_products cp using collections c where c.id = cp.collection_id and c.store_id = $1`,
    [storeId],
  );
  let memberships = 0;
  for (const c of collections) {
    const members = c.rules
      ? products.filter((p) =>
          productMatches(
            {
              title: p.title, tags: p.tags, productType: p.product_type, vendor: p.vendor,
              prices: p.prices, compareAtPrices: p.compare_at_prices ?? [],
            },
            c.rules!,
          ))
      : c.manual_handles.map((h) => byHandle.get(h)).filter((p): p is ProductRow => Boolean(p));
    const sorted = sortMembers(
      members.map((p) => ({
        id: p.id, handle: p.handle, title: p.title, minPrice: p.min_price, salesRank: p.sales_rank, createdAt: p.created_at,
      })),
      c.sort_order,
      c.manual_handles,
    );
    if (!sorted.length) continue;
    await db.query(
      `insert into collection_products (collection_id, product_id, position)
       select $1, m.id, m.ord from unnest($2::uuid[]) with ordinality as m(id, ord)`,
      [c.id, sorted.map((p) => p.id)],
    );
    memberships += sorted.length;
  }
  return { memberships, ranked };
}
