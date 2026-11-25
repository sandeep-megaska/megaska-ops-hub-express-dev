import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePath, parseRedirectsCsv } from "./redirects.ts";

test("parses Shopify's redirect export", () => {
  const text = readFileSync(new URL("../../test/fixtures/url_redirects.csv", import.meta.url), "utf8");
  const { redirects } = parseRedirectsCsv(text);
  assert.deepEqual(redirects, [
    { path: "/products/mwsw05-black", target: "/products/shoulder-swimsuits-coverage-cutout" },
    { path: "/products/wine", target: "/products/black" },
    { path: "/products/old-cap", target: "/products/classic-unisex-soft-silicone" },
  ]);
});

test("normalizePath", () => {
  assert.equal(normalizePath("Products/X/"), "/products/x");
  assert.equal(normalizePath("https://megaska.com/pages/faq"), "/pages/faq");
  assert.equal(normalizePath("/"), "/");
});

test("rejects other files", () => {
  assert.throws(() => parseRedirectsCsv("a,b\n1,2"), /Redirect from/);
});
