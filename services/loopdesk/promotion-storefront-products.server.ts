import type { PromotionRule, PromotionRulesConfig } from "../promotion-rules/config";

export const MAX_PROMOTION_PRODUCT_VARIANTS = 250;
const PAGE_SIZE = 100;

type Money = { amount: string; currencyCode: string };
type Image = { url: string; altText: string | null };
export type StorefrontPromotionProductStatus = "ready" | "not_found" | "unavailable" | "query_failed" | "invalid_product_gid" | "storefront_auth_unavailable";
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
export type PromotionStorefrontProductLookupDiagnostics = { credentialSource?: string; hasStorefrontToken?: boolean; lookupTransport?: "storefront_graphql" | "public_product_json"; storefrontHttpStatus?: number; fallbackAttempted?: boolean; fallbackSucceeded?: boolean };
export type PromotionStorefrontProductDiagnostics = {
  requestedProductGids: string[];
  resolvedProductGids: string[];
  missingProductGids: string[];
  productCount: number;
  variantCountsByProduct: Record<string, number>;
};

type Fetcher = (input: { shopDomain: string; productGid: string; handle?: string | null }) => Promise<StorefrontPromotionProductLookup>;

type StorefrontProductNode = {
  id?: string | null;
  handle?: string | null;
  title?: string | null;
  availableForSale?: boolean | null;
  featuredImage?: Image | null;
  options?: Array<{ id?: string | null; name?: string | null; values?: string[] | null; optionValues?: Array<{ name?: string | null }> | null }> | null;
  variants?: { nodes?: StorefrontVariantNode[] | null; pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null } | null;
};

type StorefrontVariantNode = {
  id?: string | null;
  title?: string | null;
  availableForSale?: boolean | null;
  currentlyNotInStock?: boolean | null;
  selectedOptions?: Array<{ name?: string | null; value?: string | null }> | null;
  price?: Money | null;
  compareAtPrice?: Money | null;
  image?: Image | null;
};

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
  const entries = config.rules.filter((rule) => isProductScopedReward(rule, now)).map((rule) => [canonicalProductGid(rule.reward.productGid), String(rule.reward.product?.handle || "").trim()] as const).filter(([gid, handle]) => Boolean(gid && handle));
  return Object.fromEntries(entries) as Record<string, string>;
}

function normalizeProduct(node: StorefrontProductNode, variants: StorefrontVariantNode[], variantsTruncated: boolean): StorefrontPromotionProduct | null {
  const productGid = canonicalProductGid(node.id);
  if (!productGid) return null;
  return {
    productGid,
    numericProductId: numericId(productGid),
    handle: String(node.handle || ""),
    title: String(node.title || ""),
    availableForSale: Boolean(node.availableForSale),
    featuredImage: node.featuredImage || null,
    options: (node.options || []).map((option) => ({
      id: option.id || null,
      name: String(option.name || ""),
      values: Array.isArray(option.optionValues) ? option.optionValues.map((value) => String(value.name || "")).filter(Boolean) : (option.values || []).map(String),
    })),
    variants: variants.map((variant) => ({
      variantGid: String(variant.id || ""),
      numericVariantId: numericId(String(variant.id || "")),
      title: String(variant.title || ""),
      availableForSale: Boolean(variant.availableForSale),
      currentlyNotInStock: Boolean(variant.currentlyNotInStock),
      selectedOptions: (variant.selectedOptions || []).map((option) => ({ name: String(option.name || ""), value: String(option.value || "") })),
      price: { amount: String(variant.price?.amount || "0"), currencyCode: String(variant.price?.currencyCode || "") },
      compareAtPrice: variant.compareAtPrice ? { amount: String(variant.compareAtPrice.amount || "0"), currencyCode: String(variant.compareAtPrice.currencyCode || "") } : null,
      image: variant.image || null,
    })).filter((variant) => variant.variantGid && variant.numericVariantId),
    ...(variantsTruncated ? { variantsTruncated: true } : {}),
  };
}

type AjaxProduct = { id?: number | string; handle?: string; title?: string; available?: boolean; featured_image?: string | null; images?: string[]; options?: Array<{ name?: string; values?: string[] } | string>; variants?: Array<{ id?: number | string; title?: string; available?: boolean; option1?: string | null; option2?: string | null; option3?: string | null; featured_image?: { src?: string; alt?: string | null } | string | null; price?: number | string; compare_at_price?: number | string | null }> };

function moneyFromAjax(value: unknown) {
  const cents = typeof value === "number" ? value : Number(value);
  return { amount: Number.isFinite(cents) ? (cents / 100).toFixed(2) : "0.00", currencyCode: "" };
}

function ajaxImage(value: unknown): Image | null {
  if (!value) return null;
  if (typeof value === "string") return { url: value, altText: null };
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const url = String(record.src || record.url || "").trim();
    if (url) return { url, altText: typeof record.alt === "string" ? record.alt : null };
  }
  return null;
}

function normalizeAjaxProduct(productGid: string, raw: AjaxProduct): StorefrontPromotionProduct | null {
  const normalizedProductId = String(raw.id || numericId(productGid));
  if (!/^\d+$/.test(normalizedProductId)) return null;
  const options = (raw.options || []).map((option, index) => typeof option === "string" ? { name: option, values: [] } : { name: String(option.name || `Option ${index + 1}`), values: (option.values || []).map(String) });
  const variants = (raw.variants || []).map((variant) => {
    const variantId = String(variant.id || "");
    const selectedOptions = options.map((option, index) => ({ name: option.name, value: String((variant as Record<string, unknown>)[`option${index + 1}`] || "") })).filter((option) => option.value);
    return {
      variantGid: variantId ? `gid://shopify/ProductVariant/${variantId}` : "",
      numericVariantId: variantId,
      title: String(variant.title || ""),
      availableForSale: Boolean(variant.available),
      currentlyNotInStock: !variant.available,
      selectedOptions,
      price: moneyFromAjax(variant.price),
      compareAtPrice: variant.compare_at_price == null ? null : moneyFromAjax(variant.compare_at_price),
      image: ajaxImage(variant.featured_image),
    };
  }).filter((variant) => /^\d+$/.test(variant.numericVariantId));
  return {
    productGid,
    numericProductId: normalizedProductId,
    handle: String(raw.handle || ""),
    title: String(raw.title || ""),
    availableForSale: Boolean(raw.available || variants.some((variant) => variant.availableForSale)),
    featuredImage: ajaxImage(raw.featured_image || raw.images?.[0]),
    options,
    variants,
  };
}

export async function fetchPublicProductJson(input: { shopDomain: string; productGid: string; handle?: string | null }): Promise<StorefrontPromotionProductLookup> {
  const productGid = canonicalProductGid(input.productGid);
  const handle = String(input.handle || "").trim();
  if (!productGid) return { status: "invalid_product_gid", product: null, diagnostics: { lookupTransport: "public_product_json" } };
  if (!handle) return { status: "not_found", product: null, diagnostics: { lookupTransport: "public_product_json", fallbackAttempted: true, fallbackSucceeded: false } };
  const response = await fetch(`https://${input.shopDomain}/products/${encodeURIComponent(handle)}.js`, { headers: { Accept: "application/json" } });
  if (response.status === 404) return { status: "not_found", product: null, diagnostics: { lookupTransport: "public_product_json", storefrontHttpStatus: 404, fallbackAttempted: true, fallbackSucceeded: false } };
  if (!response.ok) return { status: "unavailable", product: null, diagnostics: { lookupTransport: "public_product_json", storefrontHttpStatus: response.status, fallbackAttempted: true, fallbackSucceeded: false } };
  const product = normalizeAjaxProduct(productGid, (await response.json()) as AjaxProduct);
  if (!product) return { status: "not_found", product: null, diagnostics: { lookupTransport: "public_product_json", storefrontHttpStatus: response.status, fallbackAttempted: true, fallbackSucceeded: false } };
  return { status: product.availableForSale && product.variants.some((variant) => variant.availableForSale) ? "ready" : "unavailable", product, diagnostics: { lookupTransport: "public_product_json", storefrontHttpStatus: response.status, fallbackAttempted: true, fallbackSucceeded: true } };
}

const PRODUCT_QUERY = `
  query LoopDeskPromotionRewardProduct($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      id
      handle
      title
      availableForSale
      featuredImage { url altText }
      options { id name optionValues { name } }
      variants(first: $first, after: $after) {
        nodes {
          id
          title
          availableForSale
          currentlyNotInStock
          selectedOptions { name value }
          price { amount currencyCode }
          compareAtPrice { amount currencyCode }
          image { url altText }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export async function fetchStorefrontPromotionProduct(input: { shopId?: string; shopDomain: string; productGid: string; handle?: string | null }): Promise<StorefrontPromotionProductLookup> {
  const productGid = canonicalProductGid(input.productGid);
  if (!productGid) return { status: "invalid_product_gid", product: null };
  const variants: StorefrontVariantNode[] = [];
  let productNode: StorefrontProductNode | null = null;
  let after: string | null | undefined;
  let truncated = false;
  try {
    do {
      const remaining = MAX_PROMOTION_PRODUCT_VARIANTS - variants.length;
      const { storefrontGraphql } = await import("../shopify/storefront");
      const response = await storefrontGraphql<{ product?: StorefrontProductNode | null }>(PRODUCT_QUERY, { id: productGid, first: Math.min(PAGE_SIZE, remaining), after }, { shopDomain: input.shopDomain, shopId: input.shopId });
      const httpStatus = response.extensions?.storefrontHttpStatus;
      if (response.errors?.length) {
        if (!response.extensions?.hasStorefrontToken || httpStatus === 401 || httpStatus === 403) {
          const fallback = await fetchPublicProductJson(input);
          return { ...fallback, status: fallback.product ? fallback.status : (!response.extensions?.hasStorefrontToken ? "storefront_auth_unavailable" : fallback.status), diagnostics: { ...response.extensions, lookupTransport: fallback.diagnostics?.lookupTransport, storefrontHttpStatus: httpStatus, fallbackAttempted: true, fallbackSucceeded: Boolean(fallback.product) } };
        }
        throw new Error(response.errors.map((error) => error.message || "Storefront query failed").join("; "));
      }
      productNode = response.data?.product || null;
      if (!productNode?.id) return { status: "not_found", product: null };
      variants.push(...(productNode.variants?.nodes || []));
      after = productNode.variants?.pageInfo?.endCursor;
      truncated = Boolean(productNode.variants?.pageInfo?.hasNextPage && variants.length >= MAX_PROMOTION_PRODUCT_VARIANTS);
    } while (productNode?.variants?.pageInfo?.hasNextPage && after && variants.length < MAX_PROMOTION_PRODUCT_VARIANTS);
    const product = normalizeProduct(productNode, variants, truncated);
    if (!product) return { status: "invalid_product_gid", product: null };
    return { status: product.availableForSale ? "ready" : "unavailable", product, diagnostics: { lookupTransport: "storefront_graphql", fallbackAttempted: false, fallbackSucceeded: false } };
  } catch (error) {
    console.warn("[LoopDesk Promotion Products] Storefront product query failed", { shopId: input.shopId || null, productGid, status: "query_failed", message: error instanceof Error ? error.message : String(error || "unknown") });
    return { status: "query_failed", product: null, diagnostics: { lookupTransport: "storefront_graphql", fallbackAttempted: false, fallbackSucceeded: false } };
  }
}

export async function enrichPromotionRulesWithStorefrontProducts(input: { shopId: string; shopDomain: string; config: PromotionRulesConfig; now?: Date; fetcher?: Fetcher }) {
  const fetcher = input.fetcher || ((args) => fetchStorefrontPromotionProduct({ ...args, shopId: input.shopId }));
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
  console.info("[LoopDesk Promotion Products] storefront projection", { shopId: input.shopId, shopDomain: input.shopDomain, credentialSources: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.credentialSource || null])), hasStorefrontToken: Object.fromEntries(entries.map(([gid, lookup]) => [gid, Boolean(lookup.diagnostics?.hasStorefrontToken)])), lookupTransports: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.lookupTransport || null])), storefrontHttpStatuses: Object.fromEntries(entries.map(([gid, lookup]) => [gid, lookup.diagnostics?.storefrontHttpStatus || null])), fallbackAttempted: Object.fromEntries(entries.map(([gid, lookup]) => [gid, Boolean(lookup.diagnostics?.fallbackAttempted)])), fallbackSucceeded: Object.fromEntries(entries.map(([gid, lookup]) => [gid, Boolean(lookup.diagnostics?.fallbackSucceeded)])), ...diagnostics });
  return { config: { ...input.config, rewardProducts, rewardProductStatuses }, diagnostics };
}
