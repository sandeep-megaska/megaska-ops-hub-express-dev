import assert from "node:assert/strict";
import test from "node:test";
import { middleware } from "./middleware.ts";

function withEnv(vars: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return () => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

function makeRequest(url: string, headers: Record<string, string> = {}) {
  const request = new Request(url, { headers }) as unknown as { nextUrl: URL };
  request.nextUrl = new URL(url);
  return request as Parameters<typeof middleware>[0];
}

test("a bare top-level visit with no shop context redirects to the marketing site", () => {
  const restore = withEnv({ MARKETING_SITE_URL: "https://www.loopd2c.com" });
  const response = middleware(makeRequest("https://app.loopd2c.com/", { "sec-fetch-dest": "document" }));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://www.loopd2c.com/");
  restore();
});

test("a top-level visit carrying a known shop bounces into Shopify Admin instead of the marketing site", () => {
  const restore = withEnv({ SHOPIFY_APP_HANDLE: undefined });
  const response = middleware(
    makeRequest("https://app.loopd2c.com/?shop=megaskastore.myshopify.com", { "sec-fetch-dest": "document" }),
  );
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://megaskastore.myshopify.com/admin/apps/loopd2c-ops-hub-express-dev");
  restore();
});

test("an invalid shop value is never trusted to build a redirect target", () => {
  const response = middleware(
    makeRequest("https://app.loopd2c.com/?shop=not-a-real-shop", { "sec-fetch-dest": "document" }),
  );
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://www.loopd2c.com/");
});

test("Shopify's own iframe embed passes through with a shop-scoped CSP frame-ancestors header", () => {
  const response = middleware(
    makeRequest("https://app.loopd2c.com/admin/gst?shop=megaskastore.myshopify.com&host=abc123", { "sec-fetch-dest": "iframe" }),
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-security-policy"),
    "frame-ancestors https://megaskastore.myshopify.com https://admin.shopify.com;",
  );
});

test("an in-app client-side fetch passes through untouched", () => {
  const response = middleware(makeRequest("https://app.loopd2c.com/admin/billing", { "sec-fetch-dest": "empty" }));
  assert.equal(response.status, 200);
});

test("a request with no Sec-Fetch-Dest header fails open rather than risk breaking a real embed", () => {
  const response = middleware(makeRequest("https://app.loopd2c.com/admin/gst"));
  assert.equal(response.status, 200);
});

test("without a shop param, CSP falls back to the generic Shopify Admin/myshopify.com allowance", () => {
  const response = middleware(makeRequest("https://app.loopd2c.com/", { "sec-fetch-dest": "empty" }));
  assert.equal(response.headers.get("content-security-policy"), "frame-ancestors https://admin.shopify.com https://*.myshopify.com;");
});
