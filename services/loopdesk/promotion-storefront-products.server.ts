import type { PromotionRule, PromotionRulesConfig } from "../promotion-rules/config";

export const MAX_PROMOTION_PRODUCT_VARIANTS = 250;
const PAGE_SIZE = 100;

type Money = { amount: string; currencyCode: string };
type Image = { url: string; altText: string | null };
export type StorefrontPromotionProductStatus = "ready" | "not_found" | "unavailable" | "query_failed" | "invalid_product_gid";
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
export type StorefrontPromotionProductLookup = { status: StorefrontPromotionProductStatus; product: StorefrontPromotionProduct | null };
export type PromotionStorefrontProductDiagnostics = {
  requestedProductGids: string[];
  resolvedProductGids: string[];
  missingProductGids: string[];
  productCount: number;
  variantCountsByProduct: Record<string, number>;
};

type Fetcher = (input: { shopDomain: string; productGid: string }) => Promise<StorefrontPromotionProductLookup>;

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

export async function fetchStorefrontPromotionProduct(input: { shopId?: string; shopDomain: string; productGid: string }): Promise<StorefrontPromotionProductLookup> {
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
      const response = await storefrontGraphql<{ product?: StorefrontProductNode | null }>(PRODUCT_QUERY, { id: productGid, first: Math.min(PAGE_SIZE, remaining), after }, { shopDomain: input.shopDomain });
      if (response.errors?.length) throw new Error(response.errors.map((error) => error.message || "Storefront query failed").join("; "));
      productNode = response.data?.product || null;
      if (!productNode?.id) return { status: "not_found", product: null };
      variants.push(...(productNode.variants?.nodes || []));
      after = productNode.variants?.pageInfo?.endCursor;
      truncated = Boolean(productNode.variants?.pageInfo?.hasNextPage && variants.length >= MAX_PROMOTION_PRODUCT_VARIANTS);
    } while (productNode?.variants?.pageInfo?.hasNextPage && after && variants.length < MAX_PROMOTION_PRODUCT_VARIANTS);
    const product = normalizeProduct(productNode, variants, truncated);
    if (!product) return { status: "invalid_product_gid", product: null };
    return { status: product.availableForSale ? "ready" : "unavailable", product };
  } catch (error) {
    console.warn("[LoopDesk Promotion Products] Storefront product query failed", { shopId: input.shopId || null, productGid, status: "query_failed", message: error instanceof Error ? error.message : String(error || "unknown") });
    return { status: "query_failed", product: null };
  }
}

export async function enrichPromotionRulesWithStorefrontProducts(input: { shopId: string; shopDomain: string; config: PromotionRulesConfig; now?: Date; fetcher?: Fetcher }) {
  const fetcher = input.fetcher || ((args) => fetchStorefrontPromotionProduct({ ...args, shopId: input.shopId }));
  const requestedProductGids = selectPromotionRewardProductGids(input.config, input.now);
  const entries = await Promise.all(requestedProductGids.map(async (productGid) => [productGid, await fetcher({ shopDomain: input.shopDomain, productGid })] as const));
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
  console.info("[LoopDesk Promotion Products] storefront projection", { shopId: input.shopId, shopDomain: input.shopDomain, ...diagnostics });
  return { config: { ...input.config, rewardProducts, rewardProductStatuses }, diagnostics };
}
