// Pure functions that turn Admin API objects into database rows.
// No I/O here, so they are easy to unit test against real payloads.

import type { ShopifyCollection, ShopifyMetafield, ShopifyProduct } from "./types.ts";

/** "gid://shopify/Product/123" -> "123". Kept as a string: Postgres bigint, no JS precision loss. */
export function legacyId(gid: string): string {
  const match = /\/(\d+)(?:\?.*)?$/.exec(gid);
  if (!match) throw new Error(`Not a Shopify GID: ${gid}`);
  return match[1];
}

export function toGid(resource: string, id: string | number): string {
  return `gid://shopify/${resource}/${id}`;
}

/**
 * Metafield namespaces we do not copy. Judge.me stores prerendered review
 * widget HTML (several KB per product) that the new storefront will not use.
 */
const EXCLUDED_METAFIELD_NAMESPACES = new Set(["judgeme"]);

export function mapMetafields(nodes: ShopifyMetafield[]): Record<string, { type: string; value: string }> {
  const out: Record<string, { type: string; value: string }> = {};
  for (const m of nodes) {
    if (EXCLUDED_METAFIELD_NAMESPACES.has(m.namespace)) continue;
    out[`${m.namespace}.${m.key}`] = { type: m.type, value: m.value };
  }
  return out;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export type ProductRow = {
  shopify_id: string;
  handle: string;
  title: string;
  description_html: string;
  product_type: string;
  vendor: string;
  status: string;
  tags: string[];
  options: Array<{ name: string; position: number; values: string[] }>;
  metafields: Record<string, { type: string; value: string }>;
  seo_title: string | null;
  seo_description: string | null;
  template_suffix: string | null;
  published_at: string | null;
  min_price: string | null;
  max_price: string | null;
  shopify_created_at: string;
  shopify_updated_at: string;
};

export type VariantRow = {
  shopify_id: string;
  inventory_item_id: string | null;
  title: string;
  sku: string | null;
  position: number;
  price: string;
  compare_at_price: string | null;
  selected_options: Array<{ name: string; value: string }>;
  taxable: boolean;
  inventory_tracked: boolean;
  inventory_policy: "DENY" | "CONTINUE";
  inventory_quantity: number;
  hsn_code: string | null;
  image_shopify_id: string | null;
};

export type MediaRow = {
  shopify_id: string;
  media_type: string;
  position: number;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
};

export type MappedProduct = {
  product: ProductRow;
  variants: VariantRow[];
  media: MediaRow[];
  collectionShopifyIds: string[];
};

/** Compare decimal strings like "995.00" without floating point. */
export function compareDecimal(a: string, b: string): number {
  const toCents = (v: string) => {
    const [whole, frac = ""] = v.trim().split(".");
    return BigInt(whole + (frac + "00").slice(0, 2)); // "995.5" -> 99550n, "-5.50" -> -550n
  };
  const diff = toCents(a) - toCents(b);
  return diff === 0n ? 0 : diff < 0n ? -1 : 1;
}

export function mapProduct(p: ShopifyProduct): MappedProduct {
  const metafields = mapMetafields(p.metafields.nodes);
  const productHsn = nonEmpty(metafields["gst_pro.hsn"]?.value);

  const variants: VariantRow[] = p.variants.nodes.map((v) => ({
    shopify_id: legacyId(v.id),
    inventory_item_id: v.inventoryItem ? legacyId(v.inventoryItem.id) : null,
    title: v.title,
    sku: nonEmpty(v.sku),
    position: v.position,
    price: v.price,
    compare_at_price: v.compareAtPrice && compareDecimal(v.compareAtPrice, v.price) > 0 ? v.compareAtPrice : null,
    selected_options: v.selectedOptions,
    taxable: v.taxable,
    inventory_tracked: v.inventoryItem?.tracked ?? false,
    inventory_policy: v.inventoryPolicy === "CONTINUE" ? "CONTINUE" : "DENY",
    inventory_quantity: v.inventoryQuantity ?? 0,
    hsn_code: nonEmpty(v.inventoryItem?.harmonizedSystemCode) ?? productHsn,
    image_shopify_id: v.media.nodes[0] ? legacyId(v.media.nodes[0].id) : null,
  }));

  const media: MediaRow[] = [];
  p.media.nodes.forEach((m, index) => {
    const image = m.image ?? m.preview?.image ?? null;
    if (!image?.url) return; // e.g. a video still processing: nothing to show yet
    media.push({
      shopify_id: legacyId(m.id),
      media_type: m.mediaContentType,
      position: index + 1,
      url: image.url,
      alt: nonEmpty(m.alt) ?? nonEmpty(image.altText),
      width: image.width ?? null,
      height: image.height ?? null,
    });
  });

  const prices = variants.map((v) => v.price).sort(compareDecimal);

  return {
    product: {
      shopify_id: legacyId(p.id),
      handle: p.handle,
      title: p.title,
      description_html: p.descriptionHtml ?? "",
      product_type: p.productType ?? "",
      vendor: p.vendor ?? "",
      status: p.status,
      tags: p.tags,
      options: p.options.map((o) => ({ name: o.name, position: o.position, values: o.values })),
      metafields,
      seo_title: nonEmpty(p.seo.title),
      seo_description: nonEmpty(p.seo.description),
      template_suffix: nonEmpty(p.templateSuffix),
      published_at: p.publishedAt,
      min_price: prices[0] ?? null,
      max_price: prices[prices.length - 1] ?? null,
      shopify_created_at: p.createdAt,
      shopify_updated_at: p.updatedAt,
    },
    variants,
    media,
    collectionShopifyIds: p.collections.nodes.map((c) => legacyId(c.id)),
  };
}

export type CollectionRow = {
  shopify_id: string;
  handle: string;
  title: string;
  description_html: string;
  sort_order: string;
  image_url: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
  seo_title: string | null;
  seo_description: string | null;
  template_suffix: string | null;
  metafields: Record<string, { type: string; value: string }>;
  shopify_updated_at: string;
};

export function mapCollection(c: ShopifyCollection): CollectionRow {
  return {
    shopify_id: legacyId(c.id),
    handle: c.handle,
    title: c.title,
    description_html: c.descriptionHtml ?? "",
    sort_order: c.sortOrder,
    image_url: c.image?.url ?? null,
    image_alt: nonEmpty(c.image?.altText),
    image_width: c.image?.width ?? null,
    image_height: c.image?.height ?? null,
    seo_title: nonEmpty(c.seo.title),
    seo_description: nonEmpty(c.seo.description),
    template_suffix: nonEmpty(c.templateSuffix),
    metafields: mapMetafields(c.metafields.nodes),
    shopify_updated_at: c.updatedAt,
  };
}
