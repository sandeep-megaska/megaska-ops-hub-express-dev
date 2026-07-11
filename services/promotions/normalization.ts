const PRODUCT_GID_PREFIX = "gid://shopify/Product/";
const COLLECTION_GID_PREFIX = "gid://shopify/Collection/";

function normalizeShopifyGid(value: unknown, prefix: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return `${prefix}${trimmed}`;
  if (!trimmed.startsWith(prefix)) return null;
  const id = trimmed.slice(prefix.length);
  if (!/^\d+$/.test(id)) return null;
  return `${prefix}${id}`;
}

export function normalizeShopifyProductGid(value: unknown): string | null {
  return normalizeShopifyGid(value, PRODUCT_GID_PREFIX);
}

export function normalizeShopifyCollectionGid(value: unknown): string | null {
  return normalizeShopifyGid(value, COLLECTION_GID_PREFIX);
}

export function normalizeProductType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().normalize("NFKC").toLocaleLowerCase("und");
  return normalized ? normalized : null;
}

export function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeRewardValue(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const next = typeof value === "string" ? value.trim() : value;
  if (next === "") return null;
  const numeric = Number(next);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
