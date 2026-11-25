import { cacheLife, cacheTag } from "next/cache";
import { getPool } from "../db.ts";
import { getStoreId } from "../sync/store.ts";
import { CATALOG_TAG, REDIRECTS_TAG, collectionTag, productTag } from "./tags.ts";

// Cached reads for the storefront. Pages are served from Vercel's cache and
// only hit Postgres when a webhook or the nightly sync invalidates a tag.

/** What a shopper may see: active and published to the Online Store. */
const VISIBLE = `p.status = 'ACTIVE' and p.published_at is not null`;

export type Variant = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  selectedOptions: Array<{ name: string; value: string }>;
  available: boolean;
  imageId: string | null;
};

export type Media = { id: string; url: string; alt: string | null; width: number | null; height: number | null };

export type Product = {
  shopifyId: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  options: Array<{ name: string; position: number; values: string[] }>;
  metafields: Record<string, { type: string; value: string }>;
  seoTitle: string | null;
  seoDescription: string | null;
  variants: Variant[];
  media: Media[];
};

export type ProductCard = {
  handle: string;
  title: string;
  minPrice: string | null;
  compareAtPrice: string | null;
  available: boolean;
  images: Media[];
};

export type Collection = {
  handle: string;
  title: string;
  descriptionHtml: string;
  seoTitle: string | null;
  seoDescription: string | null;
  imageUrl: string | null;
  products: ProductCard[];
};

const AVAILABLE_SQL = `(not v.inventory_tracked or v.inventory_policy = 'CONTINUE' or v.inventory_quantity > 0)`;

export async function getProduct(handle: string): Promise<Product | null> {
  "use cache";
  cacheTag(CATALOG_TAG, productTag(handle));
  cacheLife("hours");

  const storeId = await getStoreId();
  if (!storeId) return null;
  const { rows } = await getPool().query(
    `select p.shopify_id, p.handle, p.title, p.description_html, p.product_type, p.vendor, p.tags,
            p.options, p.metafields, p.seo_title, p.seo_description,
            coalesce((select json_agg(json_build_object(
                'id', v.shopify_id::text, 'title', v.title, 'sku', v.sku, 'price', v.price::text,
                'compareAtPrice', v.compare_at_price::text, 'selectedOptions', v.selected_options,
                'available', ${AVAILABLE_SQL}, 'imageId', v.image_shopify_id::text) order by v.position)
              from product_variants v where v.product_id = p.id), '[]') as variants,
            coalesce((select json_agg(json_build_object(
                'id', m.shopify_id::text, 'url', m.url, 'alt', m.alt, 'width', m.width, 'height', m.height)
                order by m.position)
              from product_media m where m.product_id = p.id), '[]') as media
     from products p
     where p.store_id = $1 and p.handle = $2 and ${VISIBLE}`,
    [storeId, handle],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    shopifyId: r.shopify_id,
    handle: r.handle,
    title: r.title,
    descriptionHtml: r.description_html,
    productType: r.product_type,
    vendor: r.vendor,
    tags: r.tags,
    options: r.options,
    metafields: r.metafields,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    variants: r.variants,
    media: r.media,
  };
}

const CARD_SELECT = `
  p.handle, p.title, p.min_price::text as min_price,
  (select min(v.compare_at_price)::text from product_variants v
     where v.product_id = p.id and v.price = p.min_price) as compare_at_price,
  exists (select 1 from product_variants v where v.product_id = p.id and ${AVAILABLE_SQL}) as available,
  coalesce((select json_agg(json_build_object(
      'id', m.shopify_id::text, 'url', m.url, 'alt', m.alt, 'width', m.width, 'height', m.height)
      order by m.position)
    from (select * from product_media m where m.product_id = p.id order by m.position limit 2) m), '[]') as images`;

function toCard(r: Record<string, unknown>): ProductCard {
  return {
    handle: r.handle as string,
    title: r.title as string,
    minPrice: r.min_price as string | null,
    compareAtPrice: r.compare_at_price as string | null,
    available: r.available as boolean,
    images: r.images as Media[],
  };
}

export async function getCollection(handle: string): Promise<Collection | null> {
  "use cache";
  cacheTag(CATALOG_TAG, collectionTag(handle));
  cacheLife("hours");

  const storeId = await getStoreId();
  if (!storeId) return null;
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, handle, title, description_html, seo_title, seo_description, image_url
     from collections where store_id = $1 and handle = $2`,
    [storeId, handle],
  );
  const c = rows[0];
  if (!c) return null;
  const products = await pool.query(
    `select ${CARD_SELECT}
     from collection_products cp join products p on p.id = cp.product_id
     where cp.collection_id = $1 and ${VISIBLE}
     order by cp.position`,
    [c.id],
  );
  return {
    handle: c.handle,
    title: c.title,
    descriptionHtml: c.description_html,
    seoTitle: c.seo_title,
    seoDescription: c.seo_description,
    imageUrl: c.image_url,
    products: products.rows.map(toCard),
  };
}

export type CollectionSummary = { handle: string; title: string; productCount: number; image: Media | null };

/** Collections that have at least one visible product, for the home page. */
export async function listCollections(): Promise<CollectionSummary[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  const storeId = await getStoreId();
  if (!storeId) return [];
  const { rows } = await getPool().query(
    `select c.handle, c.title, count(p.id)::int as product_count,
            coalesce(
              (select json_build_object('id', 'c' || c.shopify_id, 'url', c.image_url, 'alt', c.image_alt,
                                        'width', c.image_width, 'height', c.image_height)
               where c.image_url is not null),
              (select json_build_object('id', m.shopify_id::text, 'url', m.url, 'alt', m.alt,
                                        'width', m.width, 'height', m.height)
               from collection_products cp2
               join products p2 on p2.id = cp2.product_id
               join product_media m on m.product_id = p2.id
               where cp2.collection_id = c.id and p2.status = 'ACTIVE' and p2.published_at is not null
               order by cp2.position, m.position limit 1)) as image
     from collections c
     join collection_products cp on cp.collection_id = c.id
     join products p on p.id = cp.product_id and ${VISIBLE}
     where c.store_id = $1
     group by c.id
     order by c.title`,
    [storeId],
  );
  return rows.map((r) => ({ handle: r.handle, title: r.title, productCount: r.product_count, image: r.image }));
}

export async function listProductHandles(limit = 1000): Promise<string[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  const storeId = await getStoreId();
  if (!storeId) return [];
  const { rows } = await getPool().query<{ handle: string }>(
    `select p.handle from products p where p.store_id = $1 and ${VISIBLE} order by p.handle limit $2`,
    [storeId, limit],
  );
  return rows.map((r) => r.handle);
}

export async function listCollectionHandles(): Promise<string[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  const storeId = await getStoreId();
  if (!storeId) return [];
  const { rows } = await getPool().query<{ handle: string }>(
    `select handle from collections where store_id = $1 order by handle`,
    [storeId],
  );
  return rows.map((r) => r.handle);
}

/** Shopify-style redirect for a path that no longer exists, if any. */
export async function findRedirect(path: string): Promise<string | null> {
  "use cache";
  cacheTag(REDIRECTS_TAG, CATALOG_TAG);
  cacheLife("hours");

  const storeId = await getStoreId();
  if (!storeId) return null;
  const { rows } = await getPool().query<{ target: string }>(
    `select target from url_redirects where store_id = $1 and path = $2`,
    [storeId, path.toLowerCase().replace(/\/+$/, "") || "/"],
  );
  return rows[0]?.target ?? null;
}
