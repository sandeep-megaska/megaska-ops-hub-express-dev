const PRODUCT_PREFIX = "gid://shopify/Product/";
const VARIANT_PREFIX = "gid://shopify/ProductVariant/";
const COLLECTION_PREFIX = "gid://shopify/Collection/";

export class PromotionCompilerNormalizationError extends Error { constructor(message: string) { super(message); this.name = "PromotionCompilerNormalizationError"; } }

function text(value: unknown) { if (typeof value === "number") return String(value); if (typeof value === "string") return value.trim(); if (value && typeof value === "object") { const s = String(value).trim(); return s === "[object Object]" ? "" : s; } return ""; }

export function canonicalDecimalString(value: unknown): string {
  const s = text(value);
  if (!s || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) throw new PromotionCompilerNormalizationError("Decimal value must be a finite decimal number.");
  const n = Number(s);
  if (!Number.isFinite(n)) throw new PromotionCompilerNormalizationError("Decimal value must be finite.");
  let sign = ""; let body = s;
  if (body[0] === "+" || body[0] === "-") { sign = body[0] === "-" ? "-" : ""; body = body.slice(1); }
  let [whole = "0", frac = ""] = body.split(".");
  whole = whole.replace(/^0+(?=\d)/, "") || "0";
  frac = frac.replace(/0+$/, "");
  if (whole === "0" && frac === "") return "0";
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}

export function canonicalUtcIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) throw new PromotionCompilerNormalizationError("Date value must be valid.");
  return d.toISOString();
}

export function canonicalProductGid(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.startsWith(VARIANT_PREFIX)) throw new PromotionCompilerNormalizationError("ProductVariant GIDs are not valid promotion Product GIDs.");
  const id = /^\d+$/.test(s) ? s : s.startsWith(PRODUCT_PREFIX) ? s.slice(PRODUCT_PREFIX.length) : "";
  if (!/^\d+$/.test(id)) throw new PromotionCompilerNormalizationError("Product GID must be canonical or numeric.");
  return `${PRODUCT_PREFIX}${id}`;
}

export function canonicalCollectionGid(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  const id = /^\d+$/.test(s) ? s : s.startsWith(COLLECTION_PREFIX) ? s.slice(COLLECTION_PREFIX.length) : "";
  if (!/^\d+$/.test(id)) throw new PromotionCompilerNormalizationError("Collection GID must be canonical or numeric.");
  return `${COLLECTION_PREFIX}${id}`;
}

export function canonicalOptionalText(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
export function canonicalProductType(value: unknown): string { const v = typeof value === "string" ? value.trim().normalize("NFKC").toLocaleLowerCase("und") : ""; if (!v) throw new PromotionCompilerNormalizationError("Product type must be non-empty."); return v; }
