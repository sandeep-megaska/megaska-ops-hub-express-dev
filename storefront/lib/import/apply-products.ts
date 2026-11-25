import type { Queryable } from "../db.ts";
import type { ImportedProduct } from "./shopify-products.ts";

export type ProductImportMode =
  /** The file is the whole catalog: products missing from it are archived. */
  | "full"
  /** The file has some products: others are left alone. */
  | "partial";

export type ProductImportStats = {
  productsCreated: number;
  productsUpdated: number;
  productsArchived: number;
  variantsCreated: number;
  variantsUpdated: number;
  variantsRemoved: number;
  /** Variants whose stock came from the CSV because no channel has set it yet. */
  stockFromCsv: number;
};

type ExistingVariant = { id: string; product_id: string; sku: string | null; option_values: string[] };

const key = (values: string[]) => values.map((v) => v.toLowerCase()).join("\u0000");

/**
 * Write parsed products. Run inside a transaction (see importProductsCsv) so a
 * bad file changes nothing. Identity: products by handle, variants by SKU
 * (store-wide, so a SKU can move between products) or else by option values.
 * Stock is never overwritten once Browntape (or another API client) has set it.
 */
export async function applyProducts(
  db: Queryable,
  storeId: string,
  products: ImportedProduct[],
  mode: ProductImportMode,
): Promise<ProductImportStats> {
  const stats: ProductImportStats = {
    productsCreated: 0, productsUpdated: 0, productsArchived: 0,
    variantsCreated: 0, variantsUpdated: 0, variantsRemoved: 0, stockFromCsv: 0,
  };

  for (const p of products) {
    const prices = p.variants.map((v) => Number(v.price));
    const minPrice = p.variants[prices.indexOf(Math.min(...prices))].price;
    const maxPrice = p.variants[prices.indexOf(Math.max(...prices))].price;

    const upserted = await db.query<{ id: string; inserted: boolean }>(
      `insert into products (store_id, handle, title, description_html, product_type, product_category, vendor,
                             status, published, tags, options, metafields, seo_title, seo_description,
                             min_price, max_price, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
       on conflict (store_id, handle) do update set
         title = excluded.title, description_html = excluded.description_html,
         product_type = excluded.product_type, product_category = excluded.product_category,
         vendor = excluded.vendor, status = excluded.status, published = excluded.published,
         tags = excluded.tags, options = excluded.options, metafields = excluded.metafields,
         seo_title = excluded.seo_title, seo_description = excluded.seo_description,
         min_price = excluded.min_price, max_price = excluded.max_price, updated_at = now()
       returning id, (xmax = 0) as inserted`,
      [
        storeId, p.handle, p.title, p.descriptionHtml, p.productType, p.productCategory, p.vendor, p.status,
        p.published, p.tags, JSON.stringify(p.options), JSON.stringify(p.metafields), p.seoTitle,
        p.seoDescription, minPrice, maxPrice,
      ],
    );
    const productId = upserted.rows[0].id;
    if (upserted.rows[0].inserted) stats.productsCreated++;
    else stats.productsUpdated++;

    // Existing variants: this product's, plus any elsewhere holding one of our SKUs.
    const skus = p.variants.map((v) => v.sku).filter((s): s is string => s !== null);
    const existing = (
      await db.query<ExistingVariant>(
        `select id, product_id, sku, option_values from product_variants
         where store_id = $1 and (product_id = $2 or sku = any($3::text[]))`,
        [storeId, productId, skus],
      )
    ).rows;
    const bySku = new Map(existing.filter((e) => e.sku).map((e) => [e.sku!, e]));
    const byOptions = new Map(existing.filter((e) => e.product_id === productId).map((e) => [key(e.option_values), e]));
    const kept = new Set<string>();

    for (const v of p.variants) {
      const match =
        (v.sku ? bySku.get(v.sku) : undefined) ??
        (() => {
          const candidate = byOptions.get(key(v.optionValues));
          // Don't reuse a row that belongs to a different SKU.
          return candidate && !kept.has(candidate.id) && (!candidate.sku || !v.sku || candidate.sku === v.sku) ? candidate : undefined;
        })();

      const values = [
        productId, v.sku, v.optionValues, v.position, v.price, v.compareAtPrice, v.barcode, v.weightGrams,
        v.taxable, v.hsnCode, v.inventoryTracked, v.inventoryPolicy, v.imageUrl, v.inventoryQuantity,
      ];
      if (match) {
        const res = await db.query<{ stock_from_csv: boolean }>(
          `update product_variants set
             product_id = $2, sku = $3, option_values = $4, position = $5, price = $6, compare_at_price = $7,
             barcode = $8, weight_grams = $9, taxable = $10, hsn_code = $11, inventory_tracked = $12,
             inventory_policy = $13, image_url = $14, updated_at = now(),
             inventory_quantity = case when $15::int is not null and coalesce(inventory_source, 'csv') = 'csv'
                                       then $15::int else inventory_quantity end,
             inventory_source = case when $15::int is not null and inventory_source is null then 'csv' else inventory_source end
           where id = $1
           returning ($15::int is not null and coalesce(inventory_source, 'csv') = 'csv') as stock_from_csv`,
          [match.id, ...values],
        );
        if (res.rows[0]?.stock_from_csv) stats.stockFromCsv++;
        kept.add(match.id);
        stats.variantsUpdated++;
      } else {
        const res = await db.query<{ id: string }>(
          `insert into product_variants (store_id, product_id, sku, option_values, position, price, compare_at_price,
                                         barcode, weight_grams, taxable, hsn_code, inventory_tracked, inventory_policy,
                                         image_url, inventory_quantity, inventory_source)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, coalesce($15::int, 0),
                   case when $15::int is null then null else 'csv' end)
           returning id`,
          [storeId, ...values],
        );
        if (v.inventoryQuantity !== null) stats.stockFromCsv++;
        kept.add(res.rows[0].id);
        stats.variantsCreated++;
      }
    }

    const removed = await db.query(
      `delete from product_variants where product_id = $1 and not (id = any($2::uuid[]))`,
      [productId, [...kept]],
    );
    stats.variantsRemoved += removed.rowCount ?? 0;

    await db.query(`delete from product_media where product_id = $1`, [productId]);
    if (p.media.length) {
      await db.query(
        `insert into product_media (store_id, product_id, position, url, alt)
         select $1, $2, m.position, m.url, m.alt
         from jsonb_to_recordset($3::jsonb) as m(position int, url text, alt text)`,
        [storeId, productId, JSON.stringify(p.media)],
      );
    }
  }

  if (mode === "full") {
    const archived = await db.query(
      `update products set status = 'archived', published = false, updated_at = now()
       where store_id = $1 and status <> 'archived' and not (handle = any($2::text[]))`,
      [storeId, products.map((p) => p.handle)],
    );
    stats.productsArchived = archived.rowCount ?? 0;
  }
  return stats;
}
