const SHOPIFY_PRODUCT_GID = /^gid:\/\/shopify\/Product\/(\d+)$/;
const SHOPIFY_VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/;

/** Returns Shopify product IDs in the canonical numeric representation. */
export function normalizeShopifyProductId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const raw = String(value).trim();
  const numericId = /^\d+$/.test(raw) ? raw : SHOPIFY_PRODUCT_GID.exec(raw)?.[1];
  return numericId && Number(numericId) > 0 ? numericId : null;
}

/** Returns Shopify variant IDs in canonical numeric representation, never product IDs. */
export function normalizeShopifyVariantId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  const numericId = /^\d+$/.test(raw) ? raw : SHOPIFY_VARIANT_GID.exec(raw)?.[1];
  return numericId && Number(numericId) > 0 ? numericId : null;
}

/** Includes both representations that may exist in ReviewRequest legacy data. */
export function shopifyProductIdCandidates(value: unknown): string[] {
  const normalized = normalizeShopifyProductId(value);
  return normalized ? [normalized, `gid://shopify/Product/${normalized}`] : [];
}
