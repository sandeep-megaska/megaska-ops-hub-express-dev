import test from "node:test";
import assert from "node:assert/strict";

import { buildProductTypeQueryExpression, PromotionCatalogueResolutionError, resolveCollectionTriggerProducts, resolveProductTypeTriggerProducts, resolvePromotionTriggerGroups, type ShopifyCatalogueGraphqlExecutor } from "./catalogue.server.ts";

const p = (id: string) => `gid://shopify/Product/${id}`;
const c = (id: string) => `gid://shopify/Collection/${id}`;

function collectionExec(pages: Array<{ nodes: string[]; hasNextPage?: boolean; endCursor?: string | null }> | null): ShopifyCatalogueGraphqlExecutor {
  let calls = 0;
  return async (_q, variables) => {
    if (pages === null) return { collection: null } as never;
    const page = pages[calls++] ?? pages.at(-1)!;
    return { collection: { products: { pageInfo: { hasNextPage: page.hasNextPage ?? false, endCursor: page.endCursor ?? null }, nodes: page.nodes.map((id) => ({ id })) } } } as never;
  };
}
function productTypeExec(pages: Array<{ nodes: Array<{ id: string; productType: string }>; hasNextPage?: boolean; endCursor?: string | null }>, seen: unknown[] = []): ShopifyCatalogueGraphqlExecutor {
  let calls = 0;
  return async (_q, variables) => { seen.push(variables); const page = pages[calls++] ?? pages.at(-1)!; return { products: { pageInfo: { hasNextPage: page.hasNextPage ?? false, endCursor: page.endCursor ?? null }, nodes: page.nodes } } as never; };
}
async function rejectsCode(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(fn, (error) => error instanceof PromotionCatalogueResolutionError && error.code === code);
}

test("collection validates and canonicalizes collection GIDs", async () => {
  const resolved = await resolveCollectionTriggerProducts({ id: "r", sourceType: "COLLECTION", referenceGid: "7" }, { graphql: collectionExec([{ nodes: [p("2")] }]) });
  assert.equal(resolved.group.sourceGid, c("7"));
  await rejectsCode(() => resolveCollectionTriggerProducts({ sourceType: "COLLECTION", referenceGid: "bad" }, { graphql: collectionExec([]) }), "INVALID_COLLECTION_GID");
});

test("collection not found is typed", async () => {
  await rejectsCode(() => resolveCollectionTriggerProducts({ sourceType: "COLLECTION", referenceGid: c("1") }, { graphql: collectionExec(null) }), "COLLECTION_NOT_FOUND");
});

test("collection resolves one page, empty collections, stable sorting, and duplicate products", async () => {
  const full = await resolveCollectionTriggerProducts({ id: "col", sourceType: "COLLECTION", referenceGid: c("1") }, { graphql: collectionExec([{ nodes: [p("9"), p("2"), p("9")] }]) });
  assert.deepEqual(full.group.productGids, [p("2"), p("9")]);
  assert.equal(full.pagination.pagesFetched, 1);
  const empty = await resolveCollectionTriggerProducts({ sourceType: "COLLECTION", referenceGid: c("1") }, { graphql: collectionExec([{ nodes: [] }]) });
  assert.deepEqual(empty.group.productGids, []);
});

test("collection resolves multiple pages", async () => {
  const resolved = await resolveCollectionTriggerProducts({ sourceType: "COLLECTION", referenceGid: c("1") }, { graphql: collectionExec([{ nodes: [p("3")], hasNextPage: true, endCursor: "a" }, { nodes: [p("1")] }]) });
  assert.deepEqual(resolved.group.productGids, [p("1"), p("3")]);
  assert.equal(resolved.pagination.pagesFetched, 2);
});

test("collection pagination safeguards", async () => {
  await rejectsCode(() => resolveCollectionTriggerProducts({ sourceType: "COLLECTION", referenceGid: c("1") }, { graphql: collectionExec([{ nodes: [], hasNextPage: true, endCursor: "" }]) }), "PAGINATION_CURSOR_MISSING");
  await rejectsCode(() => resolveCollectionTriggerProducts({ sourceType: "COLLECTION", referenceGid: c("1") }, { graphql: collectionExec([{ nodes: [], hasNextPage: true, endCursor: "a" }, { nodes: [], hasNextPage: true, endCursor: "a" }]) }), "PAGINATION_CURSOR_REPEATED");
  await rejectsCode(() => resolveCollectionTriggerProducts({ sourceType: "COLLECTION", referenceGid: c("1") }, { graphql: collectionExec([{ nodes: [], hasNextPage: true, endCursor: "a" }, { nodes: [], hasNextPage: true, endCursor: "b" }]), maxPages: 1 }), "MAXIMUM_PAGES_EXCEEDED");
  await rejectsCode(() => resolveCollectionTriggerProducts({ sourceType: "COLLECTION", referenceGid: c("1") }, { graphql: collectionExec([{ nodes: [p("1"), p("2")] }]), maxProducts: 1 }), "MAXIMUM_PRODUCTS_EXCEEDED");
});

test("product type normalizes, escapes search query, and matches exact normalized productType only", async () => {
  const seen: unknown[] = [];
  const resolved = await resolveProductTypeTriggerProducts({ id: "pt", sourceType: "PRODUCT_TYPE", referenceValue: '  Swim "A" \\ Gear  ' }, { graphql: productTypeExec([{ nodes: [{ id: p("2"), productType: 'swim "a" \\ gear' }, { id: p("3"), productType: 'swim "a" \\ gear plus' }] }], seen) });
  assert.equal(buildProductTypeQueryExpression('Swim "A" \\ Gear'), 'product_type:"swim \\"a\\" \\\\ gear"');
  assert.deepEqual((seen[0] as Record<string, unknown>).query, 'product_type:"swim \\"a\\" \\\\ gear"');
  assert.deepEqual(resolved.group.productGids, [p("2")]);
  assert.equal(resolved.group.sourceValue, 'swim "a" \\ gear');
});

test("product type rejects blank, resolves multiple pages, dedupes, sorts, and supports empty results", async () => {
  await rejectsCode(() => resolveProductTypeTriggerProducts({ sourceType: "PRODUCT_TYPE", referenceValue: "   " }, { graphql: productTypeExec([]) }), "INVALID_PRODUCT_TYPE");
  const resolved = await resolveProductTypeTriggerProducts({ sourceType: "PRODUCT_TYPE", referenceValue: "Socks" }, { graphql: productTypeExec([{ nodes: [{ id: p("9"), productType: "SOCKS" }], hasNextPage: true, endCursor: "x" }, { nodes: [{ id: p("1"), productType: "socks" }, { id: p("9"), productType: "socks" }] }]) });
  assert.deepEqual(resolved.group.productGids, [p("1"), p("9")]);
  const empty = await resolveProductTypeTriggerProducts({ sourceType: "PRODUCT_TYPE", referenceValue: "Hats" }, { graphql: productTypeExec([{ nodes: [] }]) });
  assert.deepEqual(empty.group.productGids, []);
});

test("product type malformed Product GID is rejected with documented sanitized policy", async () => {
  await rejectsCode(() => resolveProductTypeTriggerProducts({ sourceType: "PRODUCT_TYPE", referenceValue: "Socks" }, { graphql: productTypeExec([{ nodes: [{ id: "bad", productType: "socks" }] }]) }), "SHOPIFY_CATALOGUE_QUERY_FAILED");
});

test("orchestration preserves source identity, mode-independent grouping, zero product GraphQL calls, and sequential resolution", async () => {
  const calls: string[] = [];
  const graphql: ShopifyCatalogueGraphqlExecutor = async (_q, variables) => { calls.push(String((variables as any).id ?? (variables as any).query)); return (variables as any).id ? { collection: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: p("7") }] } } } as never : { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: p("8"), productType: "socks" }] } } as never; };
  const productOnly = await resolvePromotionTriggerGroups({ triggerReferences: [{ id: "prod", sourceType: "PRODUCT", referenceGid: p("1") }] }, { graphql });
  assert.deepEqual(productOnly.sourceGroups[0].productGids, [p("1")]);
  assert.deepEqual(calls, []);
  const mixed = await resolvePromotionTriggerGroups({ triggerReferences: [{ id: "c1", sourceType: "COLLECTION", referenceGid: c("1") }, { id: "c2", sourceType: "COLLECTION", referenceGid: c("2") }, { id: "pt", sourceType: "PRODUCT_TYPE", referenceValue: "Socks" }] }, { graphql });
  assert.deepEqual(mixed.sourceGroups.map((g) => g.sourceReferenceId), ["c1", "c2", "pt"]);
  assert.deepEqual(calls, [c("1"), c("2"), 'product_type:"socks"']);
});

test("Shopify errors are wrapped without exposing raw response details", async () => {
  await rejectsCode(() => resolveCollectionTriggerProducts({ sourceType: "COLLECTION", referenceGid: c("1") }, { graphql: async () => { throw new Error("token shpat_secret raw response"); } }), "SHOPIFY_CATALOGUE_QUERY_FAILED");
});

test("shared regression uses injected executor and catalogue module imports only narrow Shopify export", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./catalogue.server.ts", import.meta.url), "utf8"));
  assert.match(source, /shopifyAdminGraphql/);
  assert.doesNotMatch(source, /resolveShopifyAdminAccessToken|SHOPIFY_API_VERSION|X-Shopify-Access-Token/);
});
