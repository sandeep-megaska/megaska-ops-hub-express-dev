import test from "node:test";
import assert from "node:assert/strict";
import { AmbiguousShopInstallationError, selectCanonicalShopCandidate, type ShopIdentityRow } from "./shop-identity.ts";

function row(overrides: Partial<ShopIdentityRow>): ShopIdentityRow {
  return { id: "canonical", shopDomain: "megaskastore.myshopify.com", accessToken: "shpat_token", accessTokenEncrypted: null, isActive: true, myshopifyDomain: "megaskastore.myshopify.com", primaryDomain: "megaskastore.com", uninstalledAt: null, ...overrides };
}

test("request with myshopify domain resolves the canonical installed row", () => {
  const stale = row({ id: "stale", shopDomain: "megaskastore.com", myshopifyDomain: null, accessToken: null, primaryDomain: "megaskastore.com" });
  const canonical = row({ id: "canonical" });
  assert.equal(selectCanonicalShopCandidate([stale, canonical], "megaskastore.myshopify.com")?.id, "canonical");
});

test("request with primary domain resolves back to the same canonical installed row", () => {
  const stale = row({ id: "stale", shopDomain: "megaskastore.com", myshopifyDomain: null, accessToken: null, primaryDomain: "megaskastore.com" });
  const canonical = row({ id: "canonical", primaryDomain: "megaskastore.com" });
  assert.equal(selectCanonicalShopCandidate([stale, canonical], "megaskastore.com")?.id, "canonical");
});

test("duplicate stale row is not selected when canonical row has installation credentials", () => {
  const stale = row({ id: "stale", shopDomain: "megaskastore.com", myshopifyDomain: null, accessToken: null, accessTokenEncrypted: null, primaryDomain: "megaskastore.com" });
  const canonical = row({ id: "canonical", accessTokenEncrypted: "encrypted", accessToken: null, primaryDomain: "megaskastore.com" });
  assert.equal(selectCanonicalShopCandidate([stale, canonical], "megaskastore.com")?.id, "canonical");
});

test("ambiguous duplicate records fail explicitly", () => {
  const first = row({ id: "first", myshopifyDomain: "megaskastore.myshopify.com", primaryDomain: "megaskastore.com" });
  const second = row({ id: "second", shopDomain: "megaskastore-dev.myshopify.com", myshopifyDomain: "megaskastore-dev.myshopify.com", primaryDomain: "megaskastore.com" });
  assert.throws(() => selectCanonicalShopCandidate([first, second], "megaskastore.com"), AmbiguousShopInstallationError);
});
