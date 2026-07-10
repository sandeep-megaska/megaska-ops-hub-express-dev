import type { PromotionRule, PromotionRulesConfig } from "../promotion-rules/config";

export const MAX_PROMOTION_PRODUCT_VARIANTS = 250;

type Money = { amount: string; currencyCode: string };
type Image = { url: string; altText: string | null };
export type StorefrontPromotionProductStatus = "ready" | "not_found" | "unavailable" | "missing_handle" | "product_identity_mismatch" | "query_failed" | "invalid_product_gid";
export type StorefrontPromotionProduct = {
  productGid: string;
  numericProductId: string;
  handle: string;
  title: string;
  availableForSale: boolean;
  featuredImage: Image | null;
  options: Array<{ id?: string | null; name: string; values: string[] }>;
  variants: Array<{
    variantGid: string;
    numericVariantId: string;
    title: string;
    availableForSale: boolean;
    currentlyNotInStock?: boolean;
    selectedOptions: Array<{ name: string; value: string }>;
    price: Money;
    compareAtPrice: Money | null;
    image: Image | null;
  }>;
  variantsTruncated?: boolean;
};
export type StorefrontPromotionProductLookup = { status: StorefrontPromotionProductStatus; product: StorefrontPromotionProduct | null; diagnostics?: PromotionStorefrontProductLookupDiagnostics };
export type PromotionStorefrontProductLookupDiagnostics = { credentialSource?: string | null; hasStorefrontToken?: boolean; lookupTransport?: "public_product_json"; publicProductHttpStatus?: number; fallbackAttempted?: boolean; fallbackSucceeded?: boolean };
export type PromotionStorefrontProductDiagnostics = {
  requestedProductGids: string[];
  resolvedProductGids: string[];
  missingProductGids: string[];
  productCount: number;
  variantCountsByProduct: Record<string, number>;
};

type Fetcher = (input: { shopDomain: string; productGid: string; handle?: string | null }) => Promise<StorefrontPromotionProductLookup>;

function scheduled(rule: PromotionRule, now: Date) {
  const scheduleConfig = rule.schedule || { alwaysActive: true, startAt: null, endAt: null };
  if (scheduleConfig.alwaysActive !== false) return true;
  const time = now.getTime();
  const start = scheduleConfig.startAt ? Date.parse(scheduleConfig.startAt) : NaN;
  const end = scheduleConfig.endAt ? Date.parse(scheduleConfig.endAt) : NaN;
  return (!Number.isFinite(start) || time >= start) && (!Number.isFinite(end) || time <= end);
}

export function canonicalProductGid(value: unknown) {
  const input = String(value || "").trim();
  const match = input.match(/^gid:\/\/shopify\/Product\/(\d+)$/);
  if (match) return `gid://shopify/Product/${match[1]}`;
  if (/^\d+$/.test(input)) return `gid://shopify/Product/${input}`;
  return null;
}

function numericId(gid: string) {
  const tail = gid.split("/").pop() || "";
  return /^\d+$/.test(tail) ? tail : "";
}

function isProductScopedReward(rule: PromotionRule, now: Date) {
  return Boolean(
    rule.enabled &&
      rule.status === "active" &&
      scheduled(rule, now) &&
      rule.reward.type === "offer_product" &&
      (rule.reward.variantSelectionMode === "product" || rule.reward.scope === "product") &&
      canonicalProductGid(rule.reward.productGid)
  );
}

export function selectPromotionRewardProductGids(config: PromotionRulesConfig, now = new Date()) {
  if (!config.enabled) return [];
  return Array.from(new Set(config.rules.filter((rule) => isProductScopedReward(rule, now)).map((rule) => canonicalProductGid(rule.reward.productGid)).filter(Boolean) as string[]));
}

function rewardProductHandlesByGid(config: PromotionRulesConfig, now = new Date()) {
  const handles: Record<string, string> = {};
  for (const rule of config.rules.filter((candidate) => isProductScopedReward(candidate, now))) {
    const gid = canonicalProductGid(rule.reward.productGid);
    if (!gid) continue;
    const handle = String(rule.reward.product?.handle || "").trim();
    if (handles[gid] === undefined) {
      handles[gid] = handle;
    } else if (handle && handles[gid] && handle !== handles[gid]) {
      console.warn("[LoopDesk Promotion Products] Conflicting persisted reward product handles", { productGid: gid, preferredHandle: handles[gid], ignoredHandle: handle });
    }
  }
  return handles;
}

type AjaxProduct = {
  id?: number | string;
  handle?: string;
  title?: string;
  available?: boolean;
  featured_image?: string | { src?: string; url?: string; alt?: string | null } | null;
  image?: string | { src?: string; url?: string; alt?: string | null } | null;
  images?: string[];
  options?: Array<{ name?: string; values?: string[] } | string>;
  variants?: Array<{ id?: number | string; title?: string; available?: boolean; option1?: string | null; option2?: string | null; option3?: string | null; featured_image?: { src?: string; url?: string; alt?: string | null } | string | null; image?: { src?: string; url?: string; alt?: string | null } | string | null; price?: number | string; compare_at_price?: number | string | null }>;
  currency?: string;
  currency_code?: string;
};

const PUBLIC_PRODUCT_JSON_TIMEOUT_MS = 5_000;

function diagnostics(publicProductHttpStatus?: number): PromotionStorefrontProductLookupDiagnostics {
  return { credentialSource: null, hasStorefrontToken: false, lookupTransport: "public_product_json", ...(publicProductHttpStatus ? { publicProductHttpStatus } : {}), fallbackAttempted: false, fallbackSucceeded: false };
}

function safeShopHostname(shopDomain: string) {
  const hostname = String(shopDomain || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(hostname)) return null;
  return hostname;
}

function publicProductUrl(shopDomain: string, handle: string) {
  const hostname = safeShopHostname(shopDomain);
  if (!hostname) return null;
  return new URL(`/products/${encodeURIComponent(handle)}.js`, `https://${hostname}`);
}

function isSameApprovedHost(url: URL, shopDomain: string) {
  const hostname = safeShopHostname(shopDomain);
  return Boolean(hostname && url.protocol === "https:" && url.hostname.toLowerCase() === hostname);
}

function moneyFromAjax(value: unknown, currencyCode: string): Money {
  if (value == null || value === "") return { amount: "0.00", currencyCode };
  if (typeof value === "number") return { amount: (value / 100).toFixed(2), currencyCode };
  const text = String(value).trim();
  if (!text) return { amount: "0.00", currencyCode };
  if (/^-?\d+$/.test(text)) return { amount: (Number(text) / 100).toFixed(2), currencyCode };
  const parsed = Number(text);
  return { amount: Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00", currencyCode };
}

function ajaxImage(value: unknown): Image | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() ? { url: value, altText: null } : null;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const url = String(record.src || record.url || "").trim();
    if (url) return { url, altText: typeof record.alt === "string" ? record.alt : null };
  }
  return null;
}

function normalizeAjaxProduct(productGid: string, raw: AjaxProduct): StorefrontPromotionProduct | null {
  const configuredProductId = numericId(productGid);
  const returnedProductId = String(raw.id || "").trim();
  if (!configuredProductId || !/^\d+$/.test(returnedProductId) || returnedProductId !== configuredProductId) return null;
  const featuredImage = ajaxImage(raw.featured_image || raw.image || raw.images?.[0]);
  const currencyCode = String(raw.currency_code || raw.currency || "").trim();
  const options = (raw.options || []).map((option, index) => typeof option === "string" ? { name: option, values: [] } : { name: String(option.name || `Option ${index + 1}`), values: (option.values || []).map(String) });
  const variants = (raw.variants || []).map((variant) => {
    const variantId = String(variant.id || "").trim();
    const selectedOptions = options.map((option, index) => ({ name: option.name, value: String((variant as Record<string, unknown>)[`option${index + 1}`] || "") })).filter((option) => option.name && option.value);
    const image = ajaxImage(variant.featured_image || variant.image) || featuredImage;
    return {
      variantGid: /^\d+$/.test(variantId) ? `gid://shopify/ProductVariant/${variantId}` : "",
      numericVariantId: variantId,
      title: String(variant.title || ""),
      availableForSale: Boolean(variant.available),
      currentlyNotInStock: !variant.available,
      selectedOptions,
      price: moneyFromAjax(variant.price, currencyCode),
      compareAtPrice: variant.compare_at_price == null ? null : moneyFromAjax(variant.compare_at_price, currencyCode),
      image,
    };
  }).filter((variant) => /^\d+$/.test(variant.numericVariantId));
  return {
    productGid,
    numericProductId: configuredProductId,
    handle: String(raw.handle || ""),
    title: String(raw.title || ""),
    availableForSale: variants.some((variant) => variant.availableForSale),
    featuredImage,
    options,
    variants,
    variantsTruncated: false,
  };
}

async function fetchSameShopPublicJson(url: URL, shopDomain: string, signal: AbortSignal, redirects = 0): Promise<Response> {
  const response = await fetch(url, { method: "GET", redirect: "manual", signal, headers: { Accept: "application/json" } });
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;
  if (redirects >= 3) throw new Error("too_many_redirects");
  const location = response.headers.get("location");
  if (!location) throw new Error("invalid_redirect");
  const nextUrl = new URL(location, url);
  if (!isSameApprovedHost(nextUrl, shopDomain)) throw new Error("cross_domain_redirect");
  return fetchSameShopPublicJson(nextUrl, shopDomain, signal, redirects + 1);
}

export async function fetchPublicProductJson(input: { shopDomain: string; productGid: string; handle?: string | null }): Promise<StorefrontPromotionProductLookup> {
  const productGid = canonicalProductGid(input.productGid);
  const handle = String(input.handle || "").trim();
  if (!productGid) return { status: "invalid_product_gid", product: null, diagnostics: diagnostics() };
  if (!handle) return { status: "missing_handle", product: null, diagnostics: diagnostics() };
  const url = publicProductUrl(input.shopDomain, handle);
  if (!url) return { status: "query_failed", product: null, diagnostics: diagnostics() };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLIC_PRODUCT_JSON_TIMEOUT_MS);
  try {
    const response = await fetchSameShopPublicJson(url, input.shopDomain, controller.signal);
    if (response.status === 404) return { status: "not_found", product: null, diagnostics: diagnostics(404) };
    if (!response.ok) return { status: "query_failed", product: null, diagnostics: diagnostics(response.status) };
    const raw = (await response.json()) as AjaxProduct;
    const returnedId = String(raw.id || "").trim();
    if (returnedId !== numericId(productGid)) {
      console.warn("[LoopDesk Promotion Products] Public product identity mismatch", { shopDomain: safeShopHostname(input.shopDomain), configuredProductId: numericId(productGid), returnedProductId: returnedId || null });
      return { status: "product_identity_mismatch", product: null, diagnostics: diagnostics(response.status) };
    }
    const product = normalizeAjaxProduct(productGid, raw);
    if (!product) return { status: "query_failed", product: null, diagnostics: diagnostics(response.status) };
    return { status: product.availableForSale ? "ready" : "unavailable", product, diagnostics: diagnostics(response.status) };
  } catch (error) {
    console.warn("[LoopDesk Promotion Products] Public product JSON lookup failed", { shopDomain: safeShopHostname(input.shopDomain), productGid, status: "query_failed", message: error instanceof Error ? error.message : String(error || "unknown") });
    return { status: "query_failed", product: null, diagnostics: diagnostics() };
  } finally {
    clearTimeout(timeout);
  }
}

export async function enrichPromotionRulesWithStorefrontProducts(input: { shopId: string; shopDomain: string; config: PromotionRulesConfig; now?: Date; fetcher?: Fetcher }) {
  const fetcher = input.fetcher || fetchPublicProductJson;
  const requestedProductGids = selectPromotionRewardProductGids(input.config, input.now);
  const handlesByGid = rewardProductHandlesByGid(input.config, input.now);
  const entries = await Promise.all(requestedProductGids.map(async (productGid) => [productGid, await fetcher({ shopDomain: input.shopDomain, productGid, handle: handlesByGid[productGid] })] as const));
  const byGid = Object.fromEntries(entries) as Record<string, StorefrontPromotionProductLookup>;
  const rewardProducts: Record<string, StorefrontPromotionProduct> = {};
  const rewardProductStatuses: Record<string, StorefrontPromotionProductStatus> = {};
  for (const gid of requestedProductGids) {
    const lookup = byGid[gid] || { status: "not_found" as const, product: null };
    rewardProductStatuses[gid] = lookup.status;
    if (lookup.product) rewardProducts[gid] = lookup.product;
  }
  const diagnostics: PromotionStorefrontProductDiagnostics = {
    requestedProductGids,
    resolvedProductGids: Object.keys(rewardProducts),
    missingProductGids: requestedProductGids.filter((gid) => !rewardProducts[gid]),
    productCount: Object.keys(rewardProducts).length,
    variantCountsByProduct: Object.fromEntries(Object.entries(rewardProducts).map(([gid, product]) => [gid, product.variants.length])),
  };
  console.info("[LoopDesk Promotion Products] public product projection", { shopId: input.shopId, shopDomain: input.shopDomain, credentialSources: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.credentialSource || null])), hasStorefrontToken: Object.fromEntries(entries.map(([gid, lookup]) => [gid, Boolean(lookup.diagnostics?.hasStorefrontToken)])), lookupTransports: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.lookupTransport || null])), publicProductHttpStatuses: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.publicProductHttpStatus || null])), fallbackAttempted: Object.fromEntries(entries.map(([gid, lookup]) => [gid, Boolean(lookup.diagnostics?.fallbackAttempted)])), fallbackSucceeded: Object.fromEntries(entries.map(([gid, lookup]) => [gid, Boolean(lookup.diagnostics?.fallbackSucceeded)])), ...diagnostics });
  return { config: { ...input.config, rewardProducts, rewardProductStatuses }, diagnostics };
}
