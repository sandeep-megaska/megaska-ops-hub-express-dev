import { withTransaction } from "../db.ts";
import { adminGraphql } from "../shopify/admin.ts";
import { legacyId, mapCollection, toGid, type CollectionRow } from "../shopify/map.ts";
import { COLLECTION_PRODUCTS_PAGE_QUERY, COLLECTION_QUERY } from "../shopify/queries.ts";
import type { Connection, ShopifyCollection } from "../shopify/types.ts";
import { collectionTag, productTag } from "../catalog/tags.ts";

/** Product IDs in the collection's sort order, across all pages. */
export async function fetchCollectionProductIds(collectionShopifyId: string): Promise<string[]> {
  const id = toGid("Collection", collectionShopifyId);
  const ids: string[] = [];
  let after: string | null = null;
  for (;;) {
    const data: { collection: { products: Connection<{ id: string }> } | null } = await adminGraphql(
      COLLECTION_PRODUCTS_PAGE_QUERY,
      { id, after },
    );
    if (!data.collection) break;
    ids.push(...data.collection.products.nodes.map((n) => legacyId(n.id)));
    const pageInfo = data.collection.products.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }
  return ids;
}

/**
 * Write a collection and replace its product list, keeping Shopify's order.
 * Products not yet in our database are skipped; the full sync adds them.
 */
export async function upsertCollection(
  storeId: string,
  c: CollectionRow,
  productShopifyIds: string[],
): Promise<string[]> {
  return withTransaction(async (db) => {
    const previous = await db.query<{ handle: string }>(
      `select handle from collections where store_id = $1 and shopify_id = $2`,
      [storeId, c.shopify_id],
    );
    await db.query(
      `update collections set handle = handle || '--' || shopify_id
       where store_id = $1 and handle = $2 and shopify_id <> $3`,
      [storeId, c.handle, c.shopify_id],
    );
    const upserted = await db.query<{ id: string }>(
      `insert into collections (
         store_id, shopify_id, handle, title, description_html, sort_order, image_url, image_alt,
         image_width, image_height, seo_title, seo_description, template_suffix, metafields,
         shopify_updated_at, synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       on conflict (store_id, shopify_id) do update set
         handle = excluded.handle, title = excluded.title, description_html = excluded.description_html,
         sort_order = excluded.sort_order, image_url = excluded.image_url, image_alt = excluded.image_alt,
         image_width = excluded.image_width, image_height = excluded.image_height,
         seo_title = excluded.seo_title, seo_description = excluded.seo_description,
         template_suffix = excluded.template_suffix, metafields = excluded.metafields,
         shopify_updated_at = excluded.shopify_updated_at, synced_at = now()
       returning id`,
      [
        storeId, c.shopify_id, c.handle, c.title, c.description_html, c.sort_order, c.image_url, c.image_alt,
        c.image_width, c.image_height, c.seo_title, c.seo_description, c.template_suffix,
        JSON.stringify(c.metafields), c.shopify_updated_at,
      ],
    );
    const collectionId = upserted.rows[0].id;

    const removed = await db.query<{ handle: string }>(
      `delete from collection_products cp using products p
       where cp.collection_id = $1 and p.id = cp.product_id and not (p.shopify_id = any($2::bigint[]))
       returning p.handle`,
      [collectionId, productShopifyIds],
    );
    const members = await db.query<{ handle: string }>(
      `insert into collection_products (collection_id, product_id, position)
       select $1, p.id, ids.ord
       from unnest($3::bigint[]) with ordinality as ids(shopify_id, ord)
       join products p on p.store_id = $2 and p.shopify_id = ids.shopify_id
       on conflict (collection_id, product_id) do update set position = excluded.position
       returning (select handle from products where id = product_id) as handle`,
      [collectionId, storeId, productShopifyIds],
    );

    const tags = new Set<string>([collectionTag(c.handle)]);
    const previousHandle = previous.rows[0]?.handle;
    if (previousHandle && previousHandle !== c.handle) tags.add(collectionTag(previousHandle));
    // Product pages show their collections (breadcrumbs), so membership changes touch them too.
    for (const row of removed.rows) tags.add(productTag(row.handle));
    if (!previous.rows[0]) for (const row of members.rows) tags.add(productTag(row.handle));
    return [...tags];
  });
}

export async function deleteCollection(storeId: string, shopifyId: string): Promise<string[]> {
  return withTransaction(async (db) => {
    const deleted = await db.query<{ handle: string }>(
      `delete from collections where store_id = $1 and shopify_id = $2 returning handle`,
      [storeId, shopifyId],
    );
    return deleted.rows.map((r) => collectionTag(r.handle));
  });
}

export async function syncCollection(storeId: string, shopifyIdOrGid: string): Promise<string[]> {
  const shopifyId = shopifyIdOrGid.startsWith("gid://") ? legacyId(shopifyIdOrGid) : shopifyIdOrGid;
  const data = await adminGraphql<{ collection: ShopifyCollection | null }>(COLLECTION_QUERY, {
    id: toGid("Collection", shopifyId),
  });
  if (!data.collection) return deleteCollection(storeId, shopifyId);
  const productIds = await fetchCollectionProductIds(shopifyId);
  return upsertCollection(storeId, mapCollection(data.collection), productIds);
}
