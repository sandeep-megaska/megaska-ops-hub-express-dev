import type { NextRequest } from "next/server";
import { prisma } from "../db/prisma";
import { decryptShopifyToken } from "./token-crypto";

type ResolvedShopConfig = {
  id: string | null;
  shopDomain: string;
  accessToken: string | null;
  accessTokenEncrypted: string | null;
  accessTokenDirect: string | null;
  storefrontAccessToken: string | null;
};

type ShopRow = {
  id: string;
  shopDomain: string;
  accessToken: string | null;
  accessTokenEncrypted: string | null;
  storefrontAccessToken: string | null;
  storefrontTokenEncrypted: string | null;
  scopes: string | null;
  isActive: boolean;
  myshopifyDomain: string | null;
  installationStatus: string | null;
  installedAt: Date | null;
  uninstalledAt: Date | null;
};

function trimEnv(name: string) {
  return String(process.env[name] || "").trim();
}

function rawOnConflictErrorDetails(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } } | null;
  return {
    errorCode: typeof candidate?.code === "string" ? candidate.code : typeof candidate?.meta?.code === "string" ? candidate.meta.code : null,
    errorMessage: error instanceof Error ? error.message : typeof candidate?.message === "string" ? candidate.message : String(error),
  };
}

function logDashboardSummaryShopOnConflict(
  phase: "attempt" | "success" | "failure",
  details: { shopDomain: string; resolvedShopId?: string | null; error?: unknown }
) {
  const errorDetails = details.error ? rawOnConflictErrorDetails(details.error) : { errorCode: null, errorMessage: null };
  console.info("[DASHBOARD SUMMARY ON CONFLICT DIAGNOSTIC] shop_resolver_default_shop", {
    phase,
    marker: "services/shopify/shop-resolver.ts:getDefaultShopFromConfig",
    tableName: "Shop",
    conflictTarget: "shopDomain",
    shopDomain: details.shopDomain,
    resolvedShopId: details.resolvedShopId || null,
    errorCode: errorDetails.errorCode,
    errorMessage: errorDetails.errorMessage,
  });
}

export function normalizeShopDomain(input: string | null | undefined) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function getShopDomainFromRequest(req: NextRequest) {
  const headerDomain = normalizeShopDomain(req.headers.get("x-shopify-shop-domain"));
  if (headerDomain) return headerDomain;

  const url = new URL(req.url);
  const queryDomain = normalizeShopDomain(url.searchParams.get("shop"));
  if (queryDomain) return queryDomain;

  return "";
}

export async function getShopByDomain(shopDomain: string) {
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized) return null;

  const rows = await prisma.$queryRawUnsafe<ShopRow[]>(
    `SELECT "id", "shopDomain", "accessToken", "accessTokenEncrypted", "storefrontAccessToken", "storefrontTokenEncrypted", "scopes", "isActive", "installedAt", "uninstalledAt", "myshopifyDomain", "installationStatus"
     FROM "Shop"
     WHERE "shopDomain" = $1 OR "myshopifyDomain" = $1
     ORDER BY CASE WHEN "installationStatus" = 'ACTIVE' THEN 0 ELSE 1 END, "updatedAt" DESC
     LIMIT 1`,
    normalized
  );

  return rows[0] || null;
}

export async function getDefaultShopFromConfig() {
  const envDomain = normalizeShopDomain(trimEnv("SHOPIFY_STORE_DOMAIN"));
  if (!envDomain) return null;

  const existing = await getShopByDomain(envDomain);
  if (existing) return existing;

  const envAdminToken = trimEnv("SHOPIFY_ADMIN_ACCESS_TOKEN") || null;
  const envStorefrontToken = trimEnv("SHOPIFY_STOREFRONT_ACCESS_TOKEN") || null;

  // TODO(multistore): remove env bootstrap fallback once install flow persists shop tokens for every store.
  logDashboardSummaryShopOnConflict("attempt", { shopDomain: envDomain, resolvedShopId: null });

  try {
    const rows = await prisma.$queryRawUnsafe<ShopRow[]>(
      `INSERT INTO "Shop" ("id", "shopDomain", "accessToken", "storefrontAccessToken", "isActive", "installedAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, true, NOW(), NOW(), NOW())
       ON CONFLICT ("shopDomain")
       DO UPDATE SET
         "accessToken" = COALESCE(EXCLUDED."accessToken", "Shop"."accessToken"),
         "storefrontAccessToken" = COALESCE(EXCLUDED."storefrontAccessToken", "Shop"."storefrontAccessToken"),
         "isActive" = true,
         "updatedAt" = NOW()
       RETURNING "id", "shopDomain", "accessToken", "accessTokenEncrypted", "storefrontAccessToken", "storefrontTokenEncrypted", "scopes", "isActive", "installedAt", "uninstalledAt", "myshopifyDomain", "installationStatus"`,
      envDomain,
      envAdminToken,
      envStorefrontToken
    );

    const resolvedShop = rows[0] || null;
    logDashboardSummaryShopOnConflict("success", { shopDomain: envDomain, resolvedShopId: resolvedShop?.id || null });
    return resolvedShop;
  } catch (error) {
    logDashboardSummaryShopOnConflict("failure", { shopDomain: envDomain, resolvedShopId: null, error });
    throw error;
  }
}

export async function resolveShopConfig(preferredShopDomain?: string | null): Promise<ResolvedShopConfig> {
  const normalizedPreferred = normalizeShopDomain(preferredShopDomain);
  if (normalizedPreferred) {
    const shop = await getShopByDomain(normalizedPreferred);
    if (shop) {
      return {
        id: shop.id,
        shopDomain: shop.shopDomain,
        accessToken: shop.accessToken || decryptShopifyToken(shop.accessTokenEncrypted),
        accessTokenEncrypted: shop.accessTokenEncrypted,
        accessTokenDirect: shop.accessToken,
        storefrontAccessToken: shop.storefrontAccessToken || decryptShopifyToken(shop.storefrontTokenEncrypted),
      };
    }
  }

  const defaultShop = await getDefaultShopFromConfig();
  if (defaultShop) {
    return {
      id: defaultShop.id,
      shopDomain: defaultShop.shopDomain,
      accessToken: defaultShop.accessToken || decryptShopifyToken(defaultShop.accessTokenEncrypted),
      accessTokenEncrypted: defaultShop.accessTokenEncrypted,
      accessTokenDirect: defaultShop.accessToken,
      storefrontAccessToken: defaultShop.storefrontAccessToken || decryptShopifyToken(defaultShop.storefrontTokenEncrypted),
    };
  }

  return {
    id: null,
    shopDomain: normalizeShopDomain(trimEnv("SHOPIFY_STORE_DOMAIN")),
    accessToken: trimEnv("SHOPIFY_ADMIN_ACCESS_TOKEN") || null,
    accessTokenEncrypted: null,
    accessTokenDirect: trimEnv("SHOPIFY_ADMIN_ACCESS_TOKEN") || null,
    storefrontAccessToken: trimEnv("SHOPIFY_STOREFRONT_ACCESS_TOKEN") || null,
  };
}
