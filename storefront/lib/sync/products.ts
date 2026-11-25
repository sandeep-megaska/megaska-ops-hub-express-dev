import { withTransaction } from "../db.ts";
import { adminGraphql } from "../shopify/admin.ts";
import { legacyId, mapProduct, toGid, type MappedProduct } from "../shopify/map.ts";
import { PRODUCT_QUERY, PRODUCT_VARIANTS_PAGE_QUERY } from "../shopify/queries.ts";
import type { Connection, ShopifyProduct, ShopifyVariant } from "../shopify/types.ts";
import { collectionTag, productTag } from "../catalog/tags.ts";

/** Fetch one product with all its variants. Null if it no longer exists. */
export async function fetchProduct(shopifyId: string): Promise<ShopifyProduct | null> {
  const id = toGid("Product", shopifyId);
  const data = await adminGraphql<{ product: ShopifyProduct | null }>(PRODUCT_QUERY, { id });
  const product = data.product;
  if (!product) return null;

  let pageInfo = product.variants.pageInfo;
  while (pageInfo?.hasNextPage) {
    const page = await adminGraphql<{ product: { variants: Connection<ShopifyVariant> } | null }>(
      PRODUCT_VARIANTS_PAGE_QUERY,
      { id, after: pageInfo.endCursor },
    );
    if (!page.product) break;
    product.variants.nodes.push(...page.product.variants.nodes);
    pageInfo = page.product.variants.pageInfo;
  }
  return product;
}

/**
 * Write a product, its variants, media and collection memberships in one
 * transaction. Returns the cache tags that now hold stale data.
 */
export async function upsertProduct(
  storeId: string,
  mapped: MappedProduct,
  /** When the data was read from Shopify. Stock newer than this is kept. */
  fetchedAt: Date = new Date(),
): Promise<string[]> {
  const p = mapped.product;
  return withTransaction(async (db) => {
    const previous = await db.query<{ handle: string }>(
      `select handle from products where store_id = $1 and shopify_id = $2`,
      [storeId, p.shopify_id],
    );

    // Handles are unique. If Shopify gave this handle to another product
    // (rename + reuse), park the old owner's handle until its own update lands.
    await db.query(
      `update products set handle = handle || '--' || shopify_id
       where store_id = $1 and handle = $2 and shopify_id <> $3`,
      [storeId, p.handle, p.shopify_id],
    );

    // The updated_at guard stops a slow, older write from overwriting a newer one.
    const upserted = await db.query<{ id: string }>(
      `insert into products (
         store_id, shopify_id, handle, title, description_html, product_type, vendor, status, tags,
         options, metafields, seo_title, seo_description, template_suffix, published_at,
         min_price, max_price, shopify_created_at, shopify_updated_at, synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
       on conflict (store_id, shopify_id) do update set
         handle = excluded.handle, title = excluded.title, description_html = excluded.description_html,
         product_type = excluded.product_type, vendor = excluded.vendor, status = excluded.status,
         tags = excluded.tags, options = excluded.options, metafields = excluded.metafields,
         seo_title = excluded.seo_title, seo_description = excluded.seo_description,
         template_suffix = excluded.template_suffix, published_at = excluded.published_at,
         min_price = excluded.min_price, max_price = excluded.max_price,
         shopify_created_at = excluded.shopify_created_at, shopify_updated_at = excluded.shopify_updated_at,
         synced_at = now()
       where products.shopify_updated_at <= excluded.shopify_updated_at
       returning id`,
      [
        storeId, p.shopify_id, p.handle, p.title, p.description_html, p.product_type, p.vendor, p.status,
        p.tags, JSON.stringify(p.options), JSON.stringify(p.metafields), p.seo_title, p.seo_description,
        p.template_suffix, p.published_at, p.min_price, p.max_price, p.shopify_created_at, p.shopify_updated_at,
      ],
    );
    const productId = upserted.rows[0]?.id;
    if (!productId) return []; // we already hold a newer version

    await db.query(
      `insert into product_variants (
         store_id, product_id, shopify_id, inventory_item_id, title, sku, position, price, compare_at_price,
         selected_options, taxable, inventory_tracked, inventory_policy, inventory_quantity, hsn_code,
         image_shopify_id, inventory_updated_at, synced_at)
       select $1, $2, v.shopify_id, v.inventory_item_id, v.title, v.sku, v.position, v.price, v.compare_at_price,
              v.selected_options, v.taxable, v.inventory_tracked, v.inventory_policy, v.inventory_quantity,
              v.hsn_code, v.image_shopify_id, $4, now()
       from jsonb_to_recordset($3::jsonb) as v(
         shopify_id bigint, inventory_item_id bigint, title text, sku text, position int, price numeric,
         compare_at_price numeric, selected_options jsonb, taxable boolean, inventory_tracked boolean,
         inventory_policy text, inventory_quantity int, hsn_code text, image_shopify_id bigint)
       on conflict (store_id, shopify_id) do update set
         product_id = excluded.product_id, inventory_item_id = excluded.inventory_item_id,
         title = excluded.title, sku = excluded.sku, position = excluded.position, price = excluded.price,
         compare_at_price = excluded.compare_at_price, selected_options = excluded.selected_options,
         taxable = excluded.taxable, inventory_tracked = excluded.inventory_tracked,
         inventory_policy = excluded.inventory_policy,
         inventory_quantity = case when product_variants.inventory_updated_at > excluded.inventory_updated_at
                                   then product_variants.inventory_quantity else excluded.inventory_quantity end,
         inventory_updated_at = greatest(product_variants.inventory_updated_at, excluded.inventory_updated_at),
         hsn_code = excluded.hsn_code, image_shopify_id = excluded.image_shopify_id, synced_at = now()`,
      [storeId, productId, JSON.stringify(mapped.variants), fetchedAt],
    );
    await db.query(
      `delete from product_variants where product_id = $1 and not (shopify_id = any($2::bigint[]))`,
      [productId, mapped.variants.map((v) => v.shopify_id)],
    );

    await db.query(
      `insert into product_media (store_id, product_id, shopify_id, media_type, position, url, alt, width, height)
       select $1, $2, m.shopify_id, m.media_type, m.position, m.url, m.alt, m.width, m.height
       from jsonb_to_recordset($3::jsonb) as m(
         shopify_id bigint, media_type text, position int, url text, alt text, width int, height int)
       on conflict (store_id, shopify_id) do update set
         product_id = excluded.product_id, media_type = excluded.media_type, position = excluded.position,
         url = excluded.url, alt = excluded.alt, width = excluded.width, height = excluded.height`,
      [storeId, productId, JSON.stringify(mapped.media)],
    );
    await db.query(
      `delete from product_media where product_id = $1 and not (shopify_id = any($2::bigint[]))`,
      [productId, mapped.media.map((m) => m.shopify_id)],
    );

    // Memberships seen from the product side. New ones go to the end of the
    // collection; the collection sync later puts them in their real position.
    const before = await db.query<{ handle: string }>(
      `select c.handle from collection_products cp join collections c on c.id = cp.collection_id
       where cp.product_id = $1`,
      [productId],
    );
    await db.query(
      `delete from collection_products cp using collections c
       where cp.product_id = $1 and c.id = cp.collection_id and not (c.shopify_id = any($2::bigint[]))`,
      [productId, mapped.collectionShopifyIds],
    );
    await db.query(
      `insert into collection_products (collection_id, product_id, position)
       select c.id, $2,
              coalesce((select max(position) from collection_products where collection_id = c.id), 0) + 1
       from collections c
       where c.store_id = $1 and c.shopify_id = any($3::bigint[])
       on conflict (collection_id, product_id) do nothing`,
      [storeId, productId, mapped.collectionShopifyIds],
    );
    const current = await db.query<{ handle: string }>(
      `select c.handle from collections c where c.store_id = $1 and c.shopify_id = any($2::bigint[])`,
      [storeId, mapped.collectionShopifyIds],
    );

    const tags = new Set<string>([productTag(p.handle)]);
    const previousHandle = previous.rows[0]?.handle;
    if (previousHandle && previousHandle !== p.handle) tags.add(productTag(previousHandle));
    for (const row of [...before.rows, ...current.rows]) tags.add(collectionTag(row.handle));
    return [...tags];
  });
}

/** Remove a product (variants, media and memberships cascade). */
export async function deleteProduct(storeId: string, shopifyId: string): Promise<string[]> {
  return withTransaction(async (db) => {
    const memberships = await db.query<{ handle: string }>(
      `select c.handle from products p
       join collection_products cp on cp.product_id = p.id
       join collections c on c.id = cp.collection_id
       where p.store_id = $1 and p.shopify_id = $2`,
      [storeId, shopifyId],
    );
    const deleted = await db.query<{ handle: string }>(
      `delete from products where store_id = $1 and shopify_id = $2 returning handle`,
      [storeId, shopifyId],
    );
    return [
      ...deleted.rows.map((r) => productTag(r.handle)),
      ...memberships.rows.map((r) => collectionTag(r.handle)),
    ];
  });
}

/** Bring one product in line with Shopify. */
export async function syncProduct(storeId: string, shopifyIdOrGid: string): Promise<string[]> {
  const shopifyId = shopifyIdOrGid.startsWith("gid://") ? legacyId(shopifyIdOrGid) : shopifyIdOrGid;
  const fetchedAt = new Date();
  const product = await fetchProduct(shopifyId);
  if (!product) return deleteProduct(storeId, shopifyId);
  return upsertProduct(storeId, mapProduct(product), fetchedAt);
}
