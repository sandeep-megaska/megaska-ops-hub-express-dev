const SHOPIFY_CUSTOMER_GID = /^gid:\/\/shopify\/Customer\/(\d+)$/;
const NUMERIC_CUSTOMER_ID = /^\d+$/;

/** Returns Shopify's canonical numeric customer id, or null for invalid input. */
export function normalizeShopifyCustomerId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null;
  const candidate = String(value).trim();
  if (!candidate) return null;
  if (NUMERIC_CUSTOMER_ID.test(candidate)) return candidate;
  return SHOPIFY_CUSTOMER_GID.exec(candidate)?.[1] ?? null;
}

export function requireShopifyCustomerId(value: unknown): string {
  const normalized = normalizeShopifyCustomerId(value);
  if (!normalized) throw new Error("Malformed Shopify customer ID");
  return normalized;
}
