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
export type PromotionStorefrontProductLookupDiagnostics = { credentialSource?: string | null; hasStorefrontToken?: boolean; lookupTransport?: "public_product_json"; publicProductHttpStatus?: number; fallbackAttempted?: boolean; fallbackSucceeded?: boolean; requestedOrigin?: string | null; finalOrigin?: string | null; approvedHosts?: string[]; redirectCount?: number; redirectChainHosts?: string[]; failureReason?: "redirect_loop" | "too_many_redirects" | "cross_tenant_redirect" | "invalid_redirect" | "network_error" | "timeout" };
export type PromotionStorefrontProductDiagnostics = {
  requestedProductGids: string[];
  resolvedProductGids: string[];
  missingProductGids: string[];
  productCount: number;
  variantCountsByProduct: Record<string, number>;
};

type PublicProductJsonInput = { shopDomain: string; primaryDomain?: string | null; myshopifyDomain?: string | null; productGid: string; handle?: string | null };
type Fetcher = (input: PublicProductJsonInput) => Promise<StorefrontPromotionProductLookup>;

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
const MAX_PUBLIC_PRODUCT_JSON_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type PublicProductFailureReason = NonNullable<PromotionStorefrontProductLookupDiagnostics["failureReason"]>;
type PublicProductAttemptResult = { response: Response; finalUrl: URL; redirectCount: number; redirectChainHosts: string[] };

function diagnostics(input: Partial<PromotionStorefrontProductLookupDiagnostics> = {}): PromotionStorefrontProductLookupDiagnostics {
  return { credentialSource: null, hasStorefrontToken: false, lookupTransport: "public_product_json", fallbackAttempted: false, fallbackSucceeded: false, ...input };
}

function normalizeApprovedHostname(domain: string | null | undefined) {
  const value = String(domain || "").trim().toLowerCase();
  if (!value) return null;
  const withoutProtocol = value.replace(/^https?:\/\//, "");
  const hostname = withoutProtocol.split("/")[0]?.split("?")[0]?.split("#")[0]?.replace(/\.$/, "") || "";
  if (!hostname || hostname.length > 253) return null;
  if (hostname === "localhost" || hostname.includes(":")) return null;
  if (!/^[a-z0-9.-]+$/.test(hostname)) return null;
  const labels = hostname.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return hostname;
}

function approvedHostsFromShop(input: { primaryDomain?: string | null; myshopifyDomain?: string | null; shopDomain: string }) {
  return Array.from(new Set([input.primaryDomain, input.myshopifyDomain, input.shopDomain].map(normalizeApprovedHostname).filter(Boolean) as string[]));
}

function publicProductUrl(hostname: string, handle: string) {
  return new URL(`/products/${encodeURIComponent(handle)}.js`, `https://${hostname}`);
}

function isApprovedHttpsUrl(url: URL, approvedHosts: Set<string>) {
  return url.protocol === "https:" && approvedHosts.has(url.hostname.toLowerCase());
}

function publicProductFailure(message: PublicProductFailureReason) {
  const error = new Error(message) as Error & { failureReason: PublicProductFailureReason };
  error.failureReason = message;
  return error;
}

function failureReasonFromError(error: unknown): PublicProductFailureReason {
  const explicit = (error as { failureReason?: PublicProductFailureReason } | null)?.failureReason;
  if (explicit) return explicit;
  const name = (error as { name?: string } | null)?.name;
  const message = error instanceof Error ? error.message : String(error || "");
  if (name === "AbortError" || /abort|timeout/i.test(message)) return "timeout";
  return "network_error";
}

async function fetchApprovedPublicJson(url: URL, approvedHosts: Set<string>, signal: AbortSignal): Promise<PublicProductAttemptResult> {
  const visitedUrls = new Set<string>();
  const redirectChainHosts: string[] = [];
  let currentUrl = url;
  for (let redirectCount = 0; ; redirectCount += 1) {
    if (!isApprovedHttpsUrl(currentUrl, approvedHosts)) throw publicProductFailure("cross_tenant_redirect");
    const current = currentUrl.toString();
    if (visitedUrls.has(current)) throw publicProductFailure("redirect_loop");
    visitedUrls.add(current);
    const response = await fetch(currentUrl, { method: "GET", redirect: "manual", signal, headers: { Accept: "application/json" } });
    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: currentUrl, redirectCount, redirectChainHosts };
    if (redirectCount >= MAX_PUBLIC_PRODUCT_JSON_REDIRECTS) throw publicProductFailure("too_many_redirects");
    const location = response.headers.get("location");
    if (!location) throw publicProductFailure("invalid_redirect");
    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw publicProductFailure("invalid_redirect");
    }
    if (!isApprovedHttpsUrl(nextUrl, approvedHosts)) throw publicProductFailure("cross_tenant_redirect");
    redirectChainHosts.push(nextUrl.hostname.toLowerCase());
    currentUrl = nextUrl;
  }
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

export async function fetchPublicProductJson(input: PublicProductJsonInput): Promise<StorefrontPromotionProductLookup> {
  const productGid = canonicalProductGid(input.productGid);
  const handle = String(input.handle || "").trim();
  const approvedHosts = approvedHostsFromShop(input);
  const originCandidates = approvedHosts.filter((host) => [normalizeApprovedHostname(input.primaryDomain), normalizeApprovedHostname(input.myshopifyDomain), normalizeApprovedHostname(input.shopDomain)].includes(host));
  const baseDiagnostics = { approvedHosts };
  if (!productGid) return { status: "invalid_product_gid", product: null, diagnostics: diagnostics(baseDiagnostics) };
  if (!handle) return { status: "missing_handle", product: null, diagnostics: diagnostics(baseDiagnostics) };
  if (!originCandidates.length) return { status: "query_failed", product: null, diagnostics: diagnostics({ ...baseDiagnostics, failureReason: "cross_tenant_redirect" }) };

  const approvedHostSet = new Set(approvedHosts);
  let fallbackAttempted = false;
  let lastDiagnostics = diagnostics(baseDiagnostics);
  for (const origin of originCandidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUBLIC_PRODUCT_JSON_TIMEOUT_MS);
    try {
      const result = await fetchApprovedPublicJson(publicProductUrl(origin, handle), approvedHostSet, controller.signal);
      const attemptDiagnostics = diagnostics({ ...baseDiagnostics, requestedOrigin: origin, finalOrigin: result.finalUrl.hostname.toLowerCase(), redirectCount: result.redirectCount, redirectChainHosts: result.redirectChainHosts, publicProductHttpStatus: result.response.status, fallbackAttempted, fallbackSucceeded: fallbackAttempted });
      if (result.response.status === 404) {
        lastDiagnostics = attemptDiagnostics;
        if (originCandidates.indexOf(origin) < originCandidates.length - 1) { fallbackAttempted = true; continue; }
        return { status: "not_found", product: null, diagnostics: attemptDiagnostics };
      }
      if (!result.response.ok) return { status: "query_failed", product: null, diagnostics: attemptDiagnostics };
      const raw = (await result.response.json()) as AjaxProduct;
      const returnedId = String(raw.id || "").trim();
      if (returnedId !== numericId(productGid)) {
        console.warn("[LoopDesk Promotion Products] Public product identity mismatch", { requestedOrigin: origin, finalOrigin: attemptDiagnostics.finalOrigin, configuredProductId: numericId(productGid), returnedProductId: returnedId || null });
        return { status: "product_identity_mismatch", product: null, diagnostics: attemptDiagnostics };
      }
      const product = normalizeAjaxProduct(productGid, raw);
      if (!product) return { status: "query_failed", product: null, diagnostics: attemptDiagnostics };
      return { status: product.availableForSale ? "ready" : "unavailable", product, diagnostics: attemptDiagnostics };
    } catch (error) {
      const failureReason = failureReasonFromError(error);
      lastDiagnostics = diagnostics({ ...baseDiagnostics, requestedOrigin: origin, fallbackAttempted, failureReason });
      const canFallback = ["network_error", "timeout"].includes(failureReason) && originCandidates.indexOf(origin) < originCandidates.length - 1;
      if (canFallback) { fallbackAttempted = true; clearTimeout(timeout); continue; }
      console.warn("[LoopDesk Promotion Products] Public product JSON lookup failed", { requestedOrigin: origin, approvedHosts, productGid, status: "query_failed", failureReason });
      return { status: "query_failed", product: null, diagnostics: lastDiagnostics };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { status: "query_failed", product: null, diagnostics: lastDiagnostics };
}

export async function enrichPromotionRulesWithStorefrontProducts(input: { shopId: string; shopDomain: string; primaryDomain?: string | null; myshopifyDomain?: string | null; config: PromotionRulesConfig; now?: Date; fetcher?: Fetcher }) {
  const fetcher = input.fetcher || fetchPublicProductJson;
  const requestedProductGids = selectPromotionRewardProductGids(input.config, input.now);
  const handlesByGid = rewardProductHandlesByGid(input.config, input.now);
  const entries = await Promise.all(requestedProductGids.map(async (productGid) => [productGid, await fetcher({ shopDomain: input.shopDomain, primaryDomain: input.primaryDomain, myshopifyDomain: input.myshopifyDomain, productGid, handle: handlesByGid[productGid] })] as const));
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
  console.info("[LoopDesk Promotion Products] public product projection", { shopId: input.shopId, shopDomain: input.shopDomain, credentialSources: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.credentialSource || null])), hasStorefrontToken: Object.fromEntries(entries.map(([gid, lookup]) => [gid, Boolean(lookup.diagnostics?.hasStorefrontToken)])), lookupTransports: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.lookupTransport || null])), publicProductHttpStatuses: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.publicProductHttpStatus || null])), failureReasons: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.failureReason || null])), requestedOrigins: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.requestedOrigin || null])), finalOrigins: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.finalOrigin || null])), redirectCounts: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.redirectCount || 0])), fallbackAttempted: Object.fromEntries(entries.map(([gid, lookup]) => [gid, Boolean(lookup.diagnostics?.fallbackAttempted)])), fallbackSucceeded: Object.fromEntries(entries.map(([gid, lookup]) => [gid, Boolean(lookup.diagnostics?.fallbackSucceeded)])), ...diagnostics });
  return { config: { ...input.config, rewardProducts, rewardProductStatuses }, diagnostics };
}
