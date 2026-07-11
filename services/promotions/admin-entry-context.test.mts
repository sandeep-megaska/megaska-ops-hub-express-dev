import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const navSourcePath = new URL("../../app/AdminNavLink.tsx", import.meta.url);
const promotionsPagePath = new URL("../../app/admin/promotions/page.tsx", import.meta.url);
const adminContextPath = new URL("./admin-context.ts", import.meta.url);

const EMBEDDED_CONTEXT_PARAMS = new Set(["shop", "shopify_shop", "host", "embedded"]);
function hrefWithEmbeddedContext(href: string, currentParams: URLSearchParams | null) {
  if (!currentParams) return href;
  const [pathAndQuery, hash = ""] = href.split("#", 2);
  const [pathname, query = ""] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);
  currentParams.forEach((value, key) => {
    if (!EMBEDDED_CONTEXT_PARAMS.has(key) || params.has(key)) return;
    params.set(key, value);
  });
  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
}

test("embedded Promotions navigation retains shop, host, and embedded", () => {
  const href = hrefWithEmbeddedContext("/admin/promotions", new URLSearchParams("shop=store.myshopify.com&host=admin-host&embedded=1&hmac=secret"));
  assert.equal(href, "/admin/promotions?shop=store.myshopify.com&host=admin-host&embedded=1");
});

test("embedded Promotions navigation retains shopify_shop when present", () => {
  const href = hrefWithEmbeddedContext("/admin/promotions", new URLSearchParams("shopify_shop=store.myshopify.com&host=admin-host&embedded=1"));
  assert.equal(href, "/admin/promotions?shopify_shop=store.myshopify.com&host=admin-host&embedded=1");
});

test("navigation from a URL with no context remains unresolved safely", () => {
  assert.equal(hrefWithEmbeddedContext("/admin/promotions", new URLSearchParams()), "/admin/promotions");
});

test("Promotions unresolved page does not silently select a default shop", async () => {
  const source = await readFile(promotionsPagePath, "utf8");
  assert.match(source, /formatAdminShopResolutionError\(resolved\)/);
  assert.doesNotMatch(source, /megaskastore\.myshopify\.com/);
});

test("context helpers and navigation contain no hard-coded shop fallback", async () => {
  const sources = await Promise.all([navSourcePath, promotionsPagePath, adminContextPath].map((path) => readFile(path, "utf8")));
  for (const source of sources) assert.doesNotMatch(source, /megaskastore\.myshopify\.com|myshopify\.com["'`]/);
});

test("AdminNavLink production helper preserves embedded context params", async () => {
  const source = await readFile(navSourcePath, "utf8");
  assert.match(source, /export function hrefWithEmbeddedContext/);
  assert.match(source, /EMBEDDED_CONTEXT_PARAMS = new Set\(\["shop", "shopify_shop", "host", "embedded"\]\)/);
  assert.match(source, /params\.set\(key, value\)/);
});
