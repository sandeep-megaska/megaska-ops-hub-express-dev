import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "../db/prisma";
import {
  AmbiguousShopInstallationError,
  ShopInstallationCredentialsMissingError,
  selectCanonicalShopCandidate,
} from "./shop-identity";
import { canonicalPublicationShopDomain, getShopByDomain, resolveShopConfig, shopRowToResolved, type ShopRow } from "./shop";

function row(overrides: Partial<ShopRow> = {}): ShopRow {
  return {
    id: "shop-installed",
    shopDomain: "example.myshopify.com",
    myshopifyDomain: "example.myshopify.com",
    primaryDomain: "example.com",
    accessToken: "token",
    accessTokenEncrypted: null,
    isActive: true,
    installationStatus: "ACTIVE",
    installedAt: new Date("2026-01-01T00:00:00Z"),
    uninstalledAt: null,
    storefrontAccessToken: "storefront-token",
    storefrontTokenEncrypted: null,
    scopes: null,
    ...overrides,
  };
}

test("tokenless stale row is never selected over an installed row", () => {
  const selected = selectCanonicalShopCandidate("example.com", [
    row({ id: "tokenless-stale", accessToken: null, accessTokenEncrypted: null, uninstalledAt: new Date("2026-01-02T00:00:00Z") }),
    row({ id: "installed", accessToken: "token" }),
  ]);
  assert.equal(selected.id, "installed");
});

test("only tokenless matching rows cause shop_installation_credentials_missing", () => {
  assert.throws(
    () => selectCanonicalShopCandidate("example.com", [row({ accessToken: null, accessTokenEncrypted: null })]),
    (error) => error instanceof ShopInstallationCredentialsMissingError && error.code === "shop_installation_credentials_missing",
  );
});

test("ambiguous installed rows cause ambiguous_shop_installation", () => {
  assert.throws(
    () => selectCanonicalShopCandidate("example.com", [
      row({ id: "first", myshopifyDomain: "first.myshopify.com", shopDomain: "first.myshopify.com" }),
      row({ id: "second", myshopifyDomain: "second.myshopify.com", shopDomain: "second.myshopify.com" }),
    ]),
    (error) => error instanceof AmbiguousShopInstallationError && error.code === "ambiguous_shop_installation",
  );
});

test("primary domain and myshopify domain resolve to the same Shop ID", () => {
  const candidates = [row({ id: "canonical" })];
  assert.equal(selectCanonicalShopCandidate("example.com", candidates).id, "canonical");
  assert.equal(selectCanonicalShopCandidate("example.myshopify.com", candidates).id, "canonical");
});

test("shopRowToResolved preserves canonical and primary domain metadata", () => {
  const resolved = shopRowToResolved(row({
    id: "domain-preservation",
    shopDomain: "merchant.example.com",
    myshopifyDomain: "example.myshopify.com",
    primaryDomain: "www.example.com",
  }));

  assert.equal(resolved.id, "domain-preservation");
  assert.equal(resolved.shopDomain, "merchant.example.com");
  assert.equal(resolved.myshopifyDomain, "example.myshopify.com");
  assert.equal(resolved.primaryDomain, "www.example.com");
});

test("canonical publication domain prefers myshopifyDomain over merchant primary domain", () => {
  assert.equal(
    canonicalPublicationShopDomain(row({ shopDomain: "example.com", myshopifyDomain: "Example.MyShopify.com", primaryDomain: "example.com" })),
    "example.myshopify.com",
  );
});

test("getShopByDomain and resolveShopConfig use the same authoritative candidate query", async () => {
  const original = prisma.$queryRawUnsafe;
  let queryCount = 0;
  const installed = row({ id: "shared-resolver", shopDomain: "example.myshopify.com" });
  prisma.$queryRawUnsafe = (async (sql: string, requested: string) => {
    queryCount += 1;
    assert.match(sql, /FROM "Shop"/);
    assert.equal(requested, "example.myshopify.com");
    return [installed];
  }) as typeof prisma.$queryRawUnsafe;

  try {
    const fromDomain = await getShopByDomain("example.myshopify.com");
    const fromConfig = await resolveShopConfig("example.myshopify.com");
    assert.equal(fromDomain?.id, "shared-resolver");
    assert.equal(fromConfig.id, "shared-resolver");
    assert.equal(fromConfig.myshopifyDomain, "example.myshopify.com");
    assert.equal(fromConfig.primaryDomain, "example.com");
    assert.equal(queryCount, 2, "one candidate SQL lookup per public resolver call");
  } finally {
    prisma.$queryRawUnsafe = original;
  }
});

test("candidate SQL lookup is not duplicated outside the authoritative function", () => {
  const source = readFileSync(new URL("./shop.ts", import.meta.url), "utf8");
  assert.equal((source.match(/FROM "Shop"/g) || []).length, 1);
  assert.match(source, /export async function queryShopIdentityCandidates/);
  assert.match(source, /export async function resolveCanonicalShopInstallation/);
});

test("runtime and admin promotion callers pass canonical publication domain", () => {
  const runtimeSource = readFileSync(new URL("../../app/api/runtime/config/route.ts", import.meta.url), "utf8");
  assert.match(runtimeSource, /const canonicalShopDomain = canonicalPublicationShopDomain\(shop\)/);
  assert.match(runtimeSource, /getLoopDeskRuntimeConfig\(shop\.id, canonicalShopDomain\)/);
  assert.doesNotMatch(runtimeSource, /getLoopDeskRuntimeConfig\(shop\.id, shop\.shopDomain\)/);

  const pageSource = readFileSync(new URL("../../app/admin/promotion-rules/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /getPromotionRulesConfig\(shop\.id, canonicalShopDomain\)/);
  assert.match(pageSource, /getLoopDeskPromotionPublicationDiagnostics\(\{ shopId: shop\.id, shopDomain: canonicalShopDomain \}\)/);
  assert.match(pageSource, /publishLoopDeskPromotions\(\{ shopId, shopDomain: canonicalShopDomain \}\)/);

  const diagnosticsSource = readFileSync(new URL("../../app/admin/promotion-rules/actions/publication-diagnostics/route.ts", import.meta.url), "utf8");
  assert.match(diagnosticsSource, /getLoopDeskPromotionPublicationDiagnostics\(\{ shopId: resolved\.shop\.id, shopDomain: canonicalShopDomain \}\)/);
  assert.match(diagnosticsSource, /publishLoopDeskPromotions\(\{ shopId: resolved\.shop\.id, shopDomain: canonicalShopDomain \}\)/);
});

test("primaryDomain is not used directly for promotion Shopify Admin publication calls", () => {
  const sources = [
    readFileSync(new URL("../../app/api/runtime/config/route.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../app/admin/promotion-rules/page.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../../app/admin/promotion-rules/actions/publication-diagnostics/route.ts", import.meta.url), "utf8"),
  ].join("\n");
  assert.doesNotMatch(sources, /shopDomain:\s*[^\n]*primaryDomain/);
  assert.doesNotMatch(sources, /getLoopDeskRuntimeConfig\([^\n]*primaryDomain/);
  assert.doesNotMatch(sources, /publishLoopDeskPromotions\([^\n]*primaryDomain/);
  assert.doesNotMatch(sources, /getLoopDeskPromotionPublicationDiagnostics\([^\n]*primaryDomain/);
});

test("no real production Shopify resource IDs are embedded in LoopDesk publication tests", () => {
  const source = readFileSync(new URL("../loopdesk/discount-function-activation.test.mts", import.meta.url), "utf8");
  assert.equal(source.includes(["162950", "8862250"].join("")), false);
  assert.match(source, /gid:\/\/shopify\/DiscountAutomaticNode\/test-current/);
});
