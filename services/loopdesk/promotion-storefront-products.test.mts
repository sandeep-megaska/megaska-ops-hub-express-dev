import test from "node:test";
import assert from "node:assert/strict";

import type { PromotionRulesConfig } from "../promotion-rules/config";

import {
  canonicalProductGid,
  enrichPromotionRulesWithStorefrontProducts,
  selectPromotionRewardProductGids,
  type StorefrontPromotionProduct,
} from "./promotion-storefront-products.server";

const now = new Date("2026-07-10T00:00:00.000Z");
const productGid = "gid://shopify/Product/9958145327402";
const variantGid = "gid://shopify/ProductVariant/501";

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

test("product-scoped active rules select canonical reward Product GIDs once", () => {
  assert.equal(canonicalProductGid("9958145327402"), productGid);
  assert.equal(canonicalProductGid(productGid), productGid);
  assert.equal(canonicalProductGid("gid://shopify/ProductVariant/1"), null);
  assert.deepEqual(selectPromotionRewardProductGids(config(), now), [productGid]);
});

test("enrichment fetches duplicate product reward GIDs once and leaves variant rewards unenriched", async () => {
  const calls: Array<{ shopDomain: string; productGid: string }> = [];
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

  assert.deepEqual(calls, [{ shopDomain: "demo.myshopify.com", productGid }]);
  assert.equal(result.config.rules[2].reward.variantGid, "gid://shopify/ProductVariant/2");
  assert.equal(result.config.rewardProducts[productGid].title, "Offered product");
  assert.equal(result.config.rewardProductStatuses[productGid], "ready");
});

test("product projection contains storefront-safe catalogue fields for future variant add", async () => {
  const result = await enrichPromotionRulesWithStorefrontProducts({
    shopId: "shop_a",
    shopDomain: "demo.myshopify.com",
    config: config(),
    now,
    fetcher: async () => ({ status: "ready", product: product() }),
  });

  const projected = result.config.rewardProducts[productGid];
  assert.equal(projected.productGid, productGid);
  assert.equal(projected.numericProductId, "9958145327402");
  assert.equal(projected.handle, "offered-product");
  assert.equal(projected.availableForSale, true);
  assert.deepEqual(projected.options[0], { id: "gid://shopify/ProductOption/1", name: "Size", values: ["S", "M"] });
  assert.equal(projected.variants[0].variantGid, variantGid);
  assert.equal(projected.variants[0].numericVariantId, "501");
  assert.deepEqual(projected.variants[0].price, { amount: "450.00", currencyCode: "INR" });
  assert.deepEqual(projected.variants[0].compareAtPrice, { amount: "999.00", currencyCode: "INR" });
  assert.equal(projected.variants[0].image?.url, "https://cdn.shopify.com/variant.jpg");
  assert.equal(projected.variants[1].availableForSale, false);
  assert.equal(projected.variants[1].currentlyNotInStock, true);
});

test("missing and query-failed products are isolated and sanitized in runtime config", async () => {
  const missing = await enrichPromotionRulesWithStorefrontProducts({
    shopId: "shop_a",
    shopDomain: "demo.myshopify.com",
    config: config(),
    now,
    fetcher: async () => ({ status: "query_failed", product: null }),
  });

  assert.deepEqual(missing.config.rewardProducts, {});
  assert.equal(missing.config.rewardProductStatuses[productGid], "query_failed");
  assert.equal(JSON.stringify(missing.config).includes("GraphQL exploded"), false);
});

test("shop domain is passed through every product lookup for tenant isolation", async () => {
  const calls: Array<{ shopDomain: string; productGid: string }> = [];
  await enrichPromotionRulesWithStorefrontProducts({
    shopId: "shop_a",
    shopDomain: "tenant-a.myshopify.com",
    config: config(),
    now,
    fetcher: async (input) => {
      calls.push(input);
      return { status: "ready", product: product() };
    },
  });
  assert.deepEqual(calls, [{ shopDomain: "tenant-a.myshopify.com", productGid }]);
});

test("runtime enrichment does not calculate cart totals or discounts", async () => {
  const result = await enrichPromotionRulesWithStorefrontProducts({
    shopId: "shop_a",
    shopDomain: "demo.myshopify.com",
    config: config(),
    now,
    fetcher: async () => ({ status: "ready", product: product() }),
  });
  const serialized = JSON.stringify(result.config);
  assert.equal(/subtotal|totalAmount|discountAmount|appliedSavings/i.test(serialized), false);
});

test("reward product handle is passed to tenant-scoped product lookup for Ajax fallback", async () => {
  const calls: Array<{ shopDomain: string; productGid: string; handle?: string | null }> = [];
  await enrichPromotionRulesWithStorefrontProducts({
    shopId: "shop_a",
    shopDomain: "tenant-a.myshopify.com",
    config: config(),
    now,
    fetcher: async (input) => {
      calls.push(input);
      return { status: "ready", product: product() };
    },
  });
  assert.deepEqual(calls, [{ shopDomain: "tenant-a.myshopify.com", productGid, handle: "offered-product" }]);
});

test("invalid or missing fallback handle returns sanitized non-ready status", async () => {
  const { fetchPublicProductJson } = await import("./promotion-storefront-products.server");
  const result = await fetchPublicProductJson({ shopDomain: "tenant-a.myshopify.com", productGid, handle: "" });
  assert.equal(result.status, "not_found");
  assert.equal(result.product, null);
  assert.equal(JSON.stringify(result).includes("token"), false);
});

test("runtime diagnostics never include token values", async () => {
  const result = await enrichPromotionRulesWithStorefrontProducts({
    shopId: "shop_a",
    shopDomain: "demo.myshopify.com",
    config: config(),
    now,
    fetcher: async () => ({
      status: "storefront_auth_unavailable",
      product: null,
      diagnostics: { credentialSource: "none", hasStorefrontToken: false, lookupTransport: "public_product_json", fallbackAttempted: true, fallbackSucceeded: false },
    }),
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("shpat_"), false);
  assert.equal(serialized.includes("storefront-secret"), false);
  assert.equal(result.config.rewardProductStatuses[productGid], "storefront_auth_unavailable");
});
