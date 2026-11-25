import { getPool } from "../db.ts";

export type ChannelVariant = {
  sku: string;
  barcode: string | null;
  product_handle: string;
  product_title: string;
  variant_title: string;
  options: Record<string, string>;
  product_type: string;
  price: string;
  mrp: string;
  hsn_code: string | null;
  weight_grams: number | null;
  taxable: boolean;
  status: "active" | "draft" | "archived";
  published: boolean;
  quantity: number;
  image_url: string | null;
  url_path: string;
};

/** Every SKU with what a channel needs to map and list it. Paginated by SKU. */
export async function listChannelVariants(storeId: string, options: { after?: string; limit: number }): Promise<ChannelVariant[]> {
  const { rows } = await getPool().query(
    `select v.sku, v.barcode, p.handle, p.title, p.options, v.option_values, p.product_type,
            v.price::text, coalesce(v.compare_at_price, v.price)::text as mrp, v.hsn_code, v.weight_grams, v.taxable,
            p.status, p.published, v.inventory_quantity,
            coalesce(v.image_url, (select m.url from product_media m where m.product_id = p.id order by m.position limit 1)) as image_url
     from product_variants v join products p on p.id = v.product_id
     where v.store_id = $1 and v.sku is not null and ($2::text is null or v.sku > $2)
     order by v.sku
     limit $3`,
    [storeId, options.after ?? null, options.limit],
  );
  return rows.map((r) => {
    const names: string[] = (r.options as Array<{ name: string }>).map((o) => o.name);
    const values: string[] = r.option_values;
    return {
      sku: r.sku,
      barcode: r.barcode,
      product_handle: r.handle,
      product_title: r.title,
      variant_title: values.filter(Boolean).join(" / ") || "Default",
      options: Object.fromEntries(names.map((n, i) => [n, values[i] ?? ""])),
      product_type: r.product_type,
      price: r.price,
      mrp: r.mrp,
      hsn_code: r.hsn_code,
      weight_grams: r.weight_grams,
      taxable: r.taxable,
      status: r.status,
      published: r.published,
      quantity: r.inventory_quantity,
      image_url: r.image_url,
      url_path: `/products/${r.handle}`,
    };
  });
}
