import type { PromotionCompilerRuleInput, PromotionCompilerTriggerReference, PromotionSourceMembershipGroup } from "./compiler-domain.ts";
import { canonicalCollectionGid, canonicalProductGid, canonicalProductType } from "./compiler-normalization.ts";

export type PromotionCatalogueErrorCode = "INVALID_COLLECTION_GID" | "COLLECTION_NOT_FOUND" | "INVALID_PRODUCT_TYPE" | "SHOPIFY_CATALOGUE_QUERY_FAILED" | "PAGINATION_CURSOR_MISSING" | "PAGINATION_CURSOR_REPEATED" | "MAXIMUM_PAGES_EXCEEDED" | "MAXIMUM_PRODUCTS_EXCEEDED";

export class PromotionCatalogueResolutionError extends Error {
  code: PromotionCatalogueErrorCode;
  cause?: unknown;
  constructor(code: PromotionCatalogueErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "PromotionCatalogueResolutionError";
    this.code = code;
    this.cause = options.cause;
  }
}

export type ShopifyCatalogueGraphqlExecutor = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;

export type CatalogueResolutionOptions = {
  shopDomain?: string | null;
  graphql?: ShopifyCatalogueGraphqlExecutor;
  pageSize?: number;
  maxPages?: number;
  maxProducts?: number;
};

export type CataloguePaginationDiagnostics = { pageSize: number; pagesFetched: number; productsSeen: number; hasNextPage: boolean; endCursor: string | null };
export type CatalogueSourceGroupResolution = { group: PromotionSourceMembershipGroup; pagination: CataloguePaginationDiagnostics };

type PageInfo = { hasNextPage: boolean; endCursor?: string | null };
type ProductNode = { id?: string | null; productType?: string | null };

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_PRODUCTS = 10_000;

const COLLECTION_PRODUCTS_QUERY = `
  query PromotionCollectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
        }
      }
    }
  }
`;

const PRODUCT_TYPE_PRODUCTS_QUERY = `
  query PromotionProductTypeProducts($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        productType
      }
    }
  }
`;

function refId(ref: PromotionCompilerTriggerReference, index = 0) { return ref.id || ref.referenceGid || ref.normalizedValue || ref.referenceValue || `${ref.sourceType}:${index}`; }
function executor(options: CatalogueResolutionOptions): ShopifyCatalogueGraphqlExecutor { return options.graphql ?? (async (query, variables, adminOptions) => { const { shopifyAdminGraphql } = await import("../shopify/admin.ts"); return shopifyAdminGraphql(query, variables, adminOptions); }); }
function limits(options: CatalogueResolutionOptions) { return { pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE, maxPages: options.maxPages ?? DEFAULT_MAX_PAGES, maxProducts: options.maxProducts ?? DEFAULT_MAX_PRODUCTS }; }
function sortedUniqueProductGids(nodes: ProductNode[], rejectMalformed: boolean) {
  const ids = new Set<string>();
  for (const node of nodes) {
    try { ids.add(canonicalProductGid(node.id)); }
    catch (cause) { if (rejectMalformed) throw new PromotionCatalogueResolutionError("SHOPIFY_CATALOGUE_QUERY_FAILED", "Shopify returned a malformed Product GID.", { cause }); }
  }
  return [...ids].sort();
}
function wrapShopifyError(error: unknown): never {
  if (error instanceof PromotionCatalogueResolutionError) throw error;
  throw new PromotionCatalogueResolutionError("SHOPIFY_CATALOGUE_QUERY_FAILED", "Shopify catalogue query failed.", { cause: error });
}
function paginationError(code: PromotionCatalogueErrorCode, message: string): never { throw new PromotionCatalogueResolutionError(code, message); }

async function paginateProducts(input: {
  query: string;
  variables: Record<string, unknown>;
  connection: (data: any) => { nodes?: ProductNode[] | null; pageInfo?: PageInfo | null } | null | undefined;
  options: CatalogueResolutionOptions;
  filter?: (node: ProductNode) => boolean;
  rejectMalformedProductGids?: boolean;
}) {
  const { pageSize, maxPages, maxProducts } = limits(input.options);
  const graphql = executor(input.options);
  const cursors = new Set<string>();
  const nodes: ProductNode[] = [];
  let after: string | null = null;
  let pagesFetched = 0;
  let pageInfo: PageInfo = { hasNextPage: false, endCursor: null };

  try {
    for (;;) {
      if (pagesFetched >= maxPages) paginationError("MAXIMUM_PAGES_EXCEEDED", "Shopify catalogue pagination exceeded the maximum page limit.");
      const data = await graphql<any>(input.query, { ...input.variables, first: pageSize, after }, { shopDomain: input.options.shopDomain ?? null });
      pagesFetched += 1;
      const connection = input.connection(data);
      pageInfo = connection?.pageInfo ?? { hasNextPage: false, endCursor: null };
      for (const node of connection?.nodes ?? []) if (!input.filter || input.filter(node)) nodes.push(node);
      if (nodes.length > maxProducts) paginationError("MAXIMUM_PRODUCTS_EXCEEDED", "Shopify catalogue pagination exceeded the maximum product limit.");
      if (!pageInfo.hasNextPage) break;
      const endCursor = typeof pageInfo.endCursor === "string" ? pageInfo.endCursor.trim() : "";
      if (!endCursor) paginationError("PAGINATION_CURSOR_MISSING", "Shopify catalogue pagination indicated another page without an end cursor.");
      if (cursors.has(endCursor)) paginationError("PAGINATION_CURSOR_REPEATED", "Shopify catalogue pagination returned a repeated cursor.");
      cursors.add(endCursor);
      after = endCursor;
    }
  } catch (error) { wrapShopifyError(error); }

  return { productGids: sortedUniqueProductGids(nodes, input.rejectMalformedProductGids ?? true), pagination: { pageSize, pagesFetched, productsSeen: nodes.length, hasNextPage: Boolean(pageInfo.hasNextPage), endCursor: pageInfo.endCursor ?? null } };
}

export function buildProductTypeQueryExpression(productType: string) {
  const normalized = canonicalProductType(productType);
  const escaped = normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `product_type:"${escaped}"`;
}

export async function resolveCollectionTriggerProducts(reference: PromotionCompilerTriggerReference, options: CatalogueResolutionOptions = {}): Promise<CatalogueSourceGroupResolution> {
  let collectionGid: string;
  try { collectionGid = canonicalCollectionGid(reference.referenceGid); } catch (cause) { throw new PromotionCatalogueResolutionError("INVALID_COLLECTION_GID", "Collection trigger reference must contain a valid Shopify Collection GID.", { cause }); }
  const result = await paginateProducts({
    query: COLLECTION_PRODUCTS_QUERY,
    variables: { id: collectionGid },
    options,
    connection: (data) => {
      if (data.collection == null) throw new PromotionCatalogueResolutionError("COLLECTION_NOT_FOUND", "Shopify collection was not found.");
      return data.collection.products;
    },
  });
  return { group: { sourceReferenceId: refId(reference), sourceType: "COLLECTION", sourceGid: collectionGid, productGids: result.productGids, unresolved: false }, pagination: result.pagination };
}

export async function resolveProductTypeTriggerProducts(reference: PromotionCompilerTriggerReference, options: CatalogueResolutionOptions = {}): Promise<CatalogueSourceGroupResolution> {
  let normalized: string;
  try { normalized = canonicalProductType(reference.normalizedValue ?? reference.referenceValue); } catch (cause) { throw new PromotionCatalogueResolutionError("INVALID_PRODUCT_TYPE", "Product-type trigger reference must contain a non-empty product type.", { cause }); }
  const queryExpression = buildProductTypeQueryExpression(normalized);
  const result = await paginateProducts({
    query: PRODUCT_TYPE_PRODUCTS_QUERY,
    variables: { query: queryExpression },
    options,
    connection: (data) => data.products,
    filter: (node) => {
      try { return canonicalProductType(node.productType) === normalized; } catch { return false; }
    },
  });
  return { group: { sourceReferenceId: refId(reference), sourceType: "PRODUCT_TYPE", sourceValue: normalized, productGids: result.productGids, unresolved: false }, pagination: result.pagination };
}

export async function resolvePromotionTriggerGroups(rule: Pick<PromotionCompilerRuleInput, "triggerReferences">, options: CatalogueResolutionOptions = {}) {
  const groups: PromotionSourceMembershipGroup[] = [];
  const pagination: CataloguePaginationDiagnostics[] = [];
  for (let index = 0; index < rule.triggerReferences.length; index += 1) {
    const ref = rule.triggerReferences[index];
    if (ref.sourceType === "PRODUCT") { const gid = canonicalProductGid(ref.referenceGid); groups.push({ sourceReferenceId: refId(ref, index), sourceType: "PRODUCT", sourceGid: gid, productGids: [gid], unresolved: false }); continue; }
    const resolved = ref.sourceType === "COLLECTION" ? await resolveCollectionTriggerProducts(ref, options) : await resolveProductTypeTriggerProducts(ref, options);
    groups.push(resolved.group);
    pagination.push(resolved.pagination);
  }
  return { sourceGroups: groups, pagination };
}
