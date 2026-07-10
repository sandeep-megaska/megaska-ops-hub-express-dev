import test from "node:test";
import assert from "node:assert/strict";

import type { PromotionRulesConfig } from "../promotion-rules/config";

import {
  canonicalProductGid,
  enrichPromotionRulesWithStorefrontProducts,
  fetchPublicProductJson,
  selectPromotionRewardProductGids,
  type StorefrontPromotionProduct,
} from "./promotion-storefront-products.server";

const now = new Date("2026-07-10T00:00:00.000Z");
const productGid = "gid://shopify/Product/9958145327402";
const secondProductGid = "gid://shopify/Product/9958145327403";
const variantGid = "gid://shopify/ProductVariant/501";
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function product(overrides: Partial<StorefrontPromotionProduct> = {}): StorefrontPromotionProduct {
  return {
    productGid,
    numericProductId: "9958145327402",
    handle: "offered-product",
    title: "Offered product",
    availableForSale: true,
    featuredImage: { url: "https://cdn.shopify.com/product.jpg", altText: "Product" },
    options: [{ id: "gid://shopify/ProductOption/1", name: "Size", values: ["S", "M"] }],
    variants: [
      {
        variantGid,
        numericVariantId: "501",
        title: "Small",
        availableForSale: true,
        currentlyNotInStock: false,
        selectedOptions: [{ name: "Size", value: "S" }],
        price: { amount: "450.00", currencyCode: "INR" },
        compareAtPrice: { amount: "999.00", currencyCode: "INR" },
        image: { url: "https://cdn.shopify.com/variant.jpg", altText: null },
      },
      {
        variantGid: "gid://shopify/ProductVariant/502",
        numericVariantId: "502",
        title: "Medium",
        availableForSale: false,
        currentlyNotInStock: true,
        selectedOptions: [{ name: "Size", value: "M" }],
        price: { amount: "450.00", currencyCode: "INR" },
        compareAtPrice: null,
        image: null,
      },
    ],
    ...overrides,
  };
}

function config(): PromotionRulesConfig {
  return {
    enabled: true,
    maxVisibleOffers: 3,
    rules: [
      {
        id: "product-reward-a",
        name: "Product reward A",
        enabled: true,
        status: "active",
        eligibility: { triggers: [{ type: "cart_contains_product", productGid: "gid://shopify/Product/1", value: "gid://shopify/Product/1" }] },
        reward: { type: "offer_product", productGid, variantSelectionMode: "product", scope: "product", quantity: 1, product: { gid: productGid, title: "Offered product", imageUrl: null, handle: "offered-product" } },
        display: { heading: "Offer", ctaLabel: "Add offer" },
      },
      {
        id: "product-reward-b",
        name: "Product reward B",
        enabled: true,
        status: "active",
        eligibility: { triggers: [{ type: "always", value: "" }] },
        reward: { type: "offer_product", productGid: "9958145327402", variantSelectionMode: "product", scope: "product", quantity: 1 },
        display: { heading: "Offer", ctaLabel: "Add offer" },
      },
      {
        id: "legacy-variant-reward",
        name: "Legacy variant reward",
        enabled: true,
        status: "active",
        eligibility: { triggers: [{ type: "always", value: "" }] },
        reward: { type: "offer_product", productGid: "gid://shopify/Product/2", variantGid: "gid://shopify/ProductVariant/2", variantSelectionMode: "variant", scope: "variant", quantity: 1 },
        display: { heading: "Offer", ctaLabel: "Add offer" },
      },
    ],
  } as unknown as PromotionRulesConfig;
}

function ajaxProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 9958145327402,
    handle: "offered-product",
    title: "Offered product",
    currency_code: "INR",
    featured_image: "https://cdn.shopify.com/product.jpg",
    options: [
      { name: "Color", values: ["Black", "Blue"] },
      { name: "Size", values: ["L", "M"] },
    ],
    variants: [
      { id: 501, title: "Black / L", available: true, option1: "Black", option2: "L", price: 69995, compare_at_price: 99995 },
      { id: "502", title: "Blue / M", available: false, option1: "Blue", option2: "M", price: "450.50", compare_at_price: null, featured_image: { src: "https://cdn.shopify.com/variant.jpg", alt: null } },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

test("product-scoped active rules select canonical reward Product GIDs once", () => {
  assert.equal(canonicalProductGid("9958145327402"), productGid);
  assert.equal(canonicalProductGid(productGid), productGid);
  assert.equal(canonicalProductGid("gid://shopify/ProductVariant/1"), null);
  assert.deepEqual(selectPromotionRewardProductGids(config(), now), [productGid]);
});

test("enrichment fetches duplicate product reward GIDs once and leaves variant rewards unenriched", async () => {
  const calls: Array<{ shopDomain: string; productGid: string; handle?: string | null }> = [];
  const result = await enrichPromotionRulesWithStorefrontProducts({
    shopId: "shop_a",
    shopDomain: "demo.myshopify.com",
    config: config(),
    now,
    fetcher: async (input) => {
      calls.push(input);
      return { status: "ready", product: product() };
    },
  });

  assert.deepEqual(calls, [{ shopDomain: "demo.myshopify.com", productGid, handle: "offered-product" }]);
  assert.equal(result.config.rules[2].reward.variantGid, "gid://shopify/ProductVariant/2");
  assert.equal(result.config.rewardProducts[productGid].title, "Offered product");
  assert.equal(result.config.rewardProductStatuses[productGid], "ready");
});

test("public product JSON normalizes ready catalogue shape, identity, variants, options, prices, and fallback images", async () => {
  let requested: { url: string; init?: RequestInit } | null = null;
  const getRequested = () => requested as { url: string; init?: RequestInit };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requested = { url: String(input), init };
    return jsonResponse(ajaxProduct());
  }) as typeof fetch;

  const result = await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", productGid, handle: "offered product" });

  assert.equal(result.status, "ready");
  assert.equal(getRequested().url, "https://demo.myshopify.com/products/offered%20product.js");
  assert.equal(getRequested().init?.headers && (getRequested().init!.headers as Record<string, string>).Accept, "application/json");
  assert.equal(JSON.stringify(getRequested().init?.headers || {}).includes("Authorization"), false);
  assert.equal(JSON.stringify(getRequested().init?.headers || {}).includes("X-Shopify-Storefront-Access-Token"), false);
  assert.equal(result.product?.productGid, productGid);
  assert.equal(result.product?.numericProductId, "9958145327402");
  assert.equal(result.product?.availableForSale, true);
  assert.deepEqual(result.product?.options, [{ name: "Color", values: ["Black", "Blue"] }, { name: "Size", values: ["L", "M"] }]);
  assert.equal(result.product?.variants[0].variantGid, "gid://shopify/ProductVariant/501");
  assert.deepEqual(result.product?.variants[0].selectedOptions, [{ name: "Color", value: "Black" }, { name: "Size", value: "L" }]);
  assert.deepEqual(result.product?.variants[0].price, { amount: "699.95", currencyCode: "INR" });
  assert.deepEqual(result.product?.variants[0].compareAtPrice, { amount: "999.95", currencyCode: "INR" });
  assert.equal(result.product?.variants[0].image?.url, "https://cdn.shopify.com/product.jpg");
  assert.equal(result.product?.variants[1].availableForSale, false);
  assert.equal(result.product?.variants[1].currentlyNotInStock, true);
  assert.equal(result.product?.variants[1].image?.url, "https://cdn.shopify.com/variant.jpg");
});

test("public product JSON returns product_identity_mismatch for stale handles", async () => {
  globalThis.fetch = (async () => jsonResponse(ajaxProduct({ id: 111 }))) as typeof fetch;
  const result = await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "product_identity_mismatch");
  assert.equal(result.product, null);
});

test("public product JSON maps HTTP 404, missing handle, unavailable, invalid JSON, network failure, timeout, and cross-tenant domains", async () => {
  globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
  assert.equal((await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", productGid, handle: "missing" })).status, "not_found");

  assert.equal((await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", productGid, handle: "" })).status, "missing_handle");

  globalThis.fetch = (async () => jsonResponse(ajaxProduct({ variants: [{ id: 501, title: "Sold out", available: false, price: 100 }] }))) as typeof fetch;
  const unavailable = await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", productGid, handle: "sold-out" });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.product?.variants[0].availableForSale, false);

  globalThis.fetch = (async () => jsonResponse("{")) as typeof fetch;
  assert.equal((await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", productGid, handle: "bad-json" })).status, "query_failed");

  globalThis.fetch = (async () => { throw new Error("socket closed"); }) as typeof fetch;
  assert.equal((await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", productGid, handle: "network" })).status, "query_failed");

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
  assert.equal((await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", productGid, handle: "timeout" })).status, "query_failed");

  assert.equal((await fetchPublicProductJson({ shopDomain: "evil.example.com", productGid, handle: "offered-product" })).status, "query_failed");
});

test("cross-domain redirects are rejected", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 302, headers: { location: "https://evil.example.com/products/offered-product.js" } })) as typeof fetch;
  const result = await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "query_failed");
  assert.equal(result.product, null);
});

test("one failed public lookup does not fail another product", async () => {
  const multi = config();
  multi.rules.push({
    ...multi.rules[0],
    id: "second-product",
    reward: { ...multi.rules[0].reward, productGid: secondProductGid, product: { gid: secondProductGid, title: "Second", imageUrl: null, handle: "second-product" } },
  } as never);
  const result = await enrichPromotionRulesWithStorefrontProducts({
    shopId: "shop_a",
    shopDomain: "demo.myshopify.com",
    config: multi,
    now,
    fetcher: async ({ productGid: gid }) => gid === productGid ? { status: "query_failed", product: null } : { status: "ready", product: product({ productGid: secondProductGid, numericProductId: "9958145327403" }) },
  });
  assert.equal(result.config.rewardProductStatuses[productGid], "query_failed");
  assert.equal(result.config.rewardProductStatuses[secondProductGid], "ready");
  assert.equal(result.config.rewardProducts[secondProductGid].numericProductId, "9958145327403");
});

test("runtime enrichment does not calculate cart totals or discounts and keeps storefront-safe runtime shapes", async () => {
  const result = await enrichPromotionRulesWithStorefrontProducts({
    shopId: "shop_a",
    shopDomain: "demo.myshopify.com",
    config: config(),
    now,
    fetcher: async () => ({ status: "ready", product: product() }),
  });
  const serialized = JSON.stringify(result.config);
  assert.equal(/subtotal|totalAmount|discountAmount|appliedSavings/i.test(serialized), false);
  assert.equal(typeof result.config.rewardProducts, "object");
  assert.equal(typeof result.config.rewardProductStatuses, "object");
  assert.equal(serialized.includes("shpat_"), false);
  assert.equal(serialized.includes("storefront-secret"), false);
});

test("public product JSON prefers primary domain over myshopify and sends no credentials", async () => {
  let requested: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requested = { url: String(input), init };
    return jsonResponse(ajaxProduct());
  }) as typeof fetch;
  const result = await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", primaryDomain: "https://store.example.com/path", myshopifyDomain: "demo.myshopify.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "ready");
  const primaryRequest = requested as { url: string; init?: RequestInit };
  assert.equal(primaryRequest.url, "https://store.example.com/products/offered-product.js");
  const headers = JSON.stringify(primaryRequest.init?.headers || {});
  assert.equal(headers.includes("Cookie"), false);
  assert.equal(headers.includes("Authorization"), false);
  assert.equal(headers.includes("X-Shopify-Storefront-Access-Token"), false);
});

test("approved redirects between myshopify and primary domains succeed including relative locations", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    if (requests.length === 1) return new Response(null, { status: 302, headers: { location: "https://store.example.com/products/offered-product.js" } });
    return jsonResponse(ajaxProduct());
  }) as typeof fetch;
  let result = await fetchPublicProductJson({ shopDomain: "store.example.com", myshopifyDomain: "store.example.com", primaryDomain: "demo.myshopify.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "ready");
  assert.equal(requests[0], "https://demo.myshopify.com/products/offered-product.js");
  assert.equal(result.diagnostics?.finalOrigin, "store.example.com");

  requests.length = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    if (requests.length === 1) return new Response(null, { status: 302, headers: { location: "/products/offered-product.js" } });
    return jsonResponse(ajaxProduct());
  }) as typeof fetch;
  result = await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", myshopifyDomain: "demo.myshopify.com", primaryDomain: "store.example.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "ready");
  assert.equal(requests[0], "https://store.example.com/products/offered-product.js");
});

test("redirect to unrelated tenant domain is rejected", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 302, headers: { location: "https://tenant-b.example.com/products/offered-product.js" } })) as typeof fetch;
  const result = await fetchPublicProductJson({ shopDomain: "tenant-a.myshopify.com", myshopifyDomain: "tenant-a.myshopify.com", primaryDomain: "tenant-a.example.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "query_failed");
  assert.equal(result.diagnostics?.failureReason, "cross_tenant_redirect");
});

test("redirect loops and excessive redirects are diagnosed", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const next = url.includes("a.example.com") ? "https://b.example.com/products/offered-product.js" : "https://a.example.com/products/offered-product.js";
    return new Response(null, { status: 302, headers: { location: next } });
  }) as typeof fetch;
  let result = await fetchPublicProductJson({ shopDomain: "a.example.com", primaryDomain: "a.example.com", myshopifyDomain: "b.example.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "query_failed");
  assert.equal(result.diagnostics?.failureReason, "redirect_loop");

  globalThis.fetch = (async () => new Response(null, { status: 302, headers: { location: "https://a.example.com/products/offered-product.js" } })) as typeof fetch;
  result = await fetchPublicProductJson({ shopDomain: "a.example.com", productGid, handle: "offered-product" });
  assert.equal(result.diagnostics?.failureReason, "redirect_loop");

  let count = 0;
  globalThis.fetch = (async () => new Response(null, { status: 302, headers: { location: `https://a.example.com/products/offered-product.js?r=${++count}` } })) as typeof fetch;
  result = await fetchPublicProductJson({ shopDomain: "a.example.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "query_failed");
  assert.equal(result.diagnostics?.failureReason, "too_many_redirects");
});

test("primary network and 404 failures fall back once but identity mismatch does not", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    if (requests.length === 1) throw new Error("ENOTFOUND");
    return jsonResponse(ajaxProduct());
  }) as typeof fetch;
  let result = await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", primaryDomain: "store.example.com", myshopifyDomain: "demo.myshopify.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "ready");
  assert.equal(requests.length, 2);
  assert.equal(result.diagnostics?.fallbackAttempted, true);
  assert.equal(result.diagnostics?.fallbackSucceeded, true);

  requests.length = 0;
  globalThis.fetch = (async (input: string | URL | Request) => { requests.push(String(input)); return jsonResponse(ajaxProduct({ id: 111 })); }) as typeof fetch;
  result = await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", primaryDomain: "store.example.com", myshopifyDomain: "demo.myshopify.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "product_identity_mismatch");
  assert.equal(requests.length, 1);

  requests.length = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    if (requests.length === 1) return new Response("not found", { status: 404 });
    return jsonResponse(ajaxProduct());
  }) as typeof fetch;
  result = await fetchPublicProductJson({ shopDomain: "demo.myshopify.com", primaryDomain: "store.example.com", myshopifyDomain: "demo.myshopify.com", productGid, handle: "offered-product" });
  assert.equal(result.status, "ready");
  assert.equal(requests.length, 2);
});
