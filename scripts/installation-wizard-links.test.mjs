import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/admin/installation-wizard/page.tsx", "utf8");

test("theme editor links open in a new tab, since Shopify admin refuses to load inside the app's frame", () => {
  assert.match(page, /\{\.\.\.\(shopifyAdmin \? \{ target: "_blank", rel: "noopener noreferrer" \} : \{\}\)\}/);
  assert.match(page, /<LinkButton href=\{appEmbedDeepLink\} shopifyAdmin>/);
  assert.match(page, /<LinkButton href=\{deliveryBlockDeepLink\} shopifyAdmin>/);
});

test("every link to a Shopify admin URL is marked, and links to the app's own pages stay in the app", () => {
  for (const match of page.matchAll(/<LinkButton href=\{([^}]+)\}( shopifyAdmin)?>/g)) {
    const isAdmin = /DeepLink$/.test(match[1]);
    assert.equal(Boolean(match[2]), isAdmin, match[0]);
  }
});
