import type { NextRequest } from "next/server";
import { prisma } from "../db/prisma";
import { decryptShopifyToken } from "./token-crypto";

type StorefrontCredentialSource =
  | "shop_row_plain"
  | "shop_row_encrypted"
  | "env_dev_fallback"
  | "none";

type ResolvedShopConfig = {
  id: string | null;
  shopDomain: string;
  accessToken: string | null;
  accessTokenEncrypted: string | null;
  accessTokenDirect: string | null;
  storefrontAccessToken: string | null;
  storefrontCredentialSource: StorefrontCredentialSource;
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

function isUsableInstallation(shop: ShopRow | null | undefined) {
  return Boolean(
    shop &&
      shop.isActive &&
      !shop.uninstalledAt &&
      String(shop.installationStatus || "ACTIVE").toUpperCase() !== "UNINSTALLED"
  );
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

export async function getShopByIdAndDomain(shopId: string, shopDomain: string) {
  const normalized = normalizeShopDomain(shopDomain);
  const id = String(shopId || "").trim();
  if (!id || !normalized) return null;

  const rows = await prisma.$queryRawUnsafe<ShopRow[]>(
    `SELECT "id", "shopDomain", "accessToken", "accessTokenEncrypted", "storefrontAccessToken", "storefrontTokenEncrypted", "scopes", "isActive", "installedAt", "uninstalledAt", "myshopifyDomain", "installationStatus"
     FROM "Shop"
     WHERE "id" = $1 AND ("shopDomain" = $2 OR "myshopifyDomain" = $2)
     ORDER BY CASE WHEN "installationStatus" = 'ACTIVE' THEN 0 ELSE 1 END, "updatedAt" DESC
     LIMIT 1`,
    id,
    normalized
  );

  return rows[0] || null;
}

function storefrontTokenFromShop(shop: ShopRow) {
  const plain = String(shop.storefrontAccessToken || "").trim();
  if (plain) return { token: plain, source: "shop_row_plain" as const };

  const decrypted = decryptShopifyToken(shop.storefrontTokenEncrypted);
  if (decrypted) return { token: decrypted, source: "shop_row_encrypted" as const };

  return { token: null, source: "none" as const };
}

function envStorefrontTokenForDevelopmentShop(shopDomain: string) {
  if (process.env.NODE_ENV === "production") return null;

  const configuredDomain = normalizeShopDomain(trimEnv("SHOPIFY_STORE_DOMAIN"));
  const requestedDomain = normalizeShopDomain(shopDomain);
  const token = trimEnv("SHOPIFY_STOREFRONT_ACCESS_TOKEN");

  if (!token || !configuredDomain || requestedDomain !== configuredDomain) return null;
  return token;
}

function unresolved(shopDomain: string): ResolvedShopConfig {
  const envToken = envStorefrontTokenForDevelopmentShop(shopDomain);
  return {
    id: null,
    shopDomain,
    accessToken: null,
    accessTokenEncrypted: null,
    accessTokenDirect: null,
    storefrontAccessToken: envToken,
    storefrontCredentialSource: envToken ? "env_dev_fallback" : "none",
  };
}

function resolved(shop: ShopRow): ResolvedShopConfig {
  const storefront = storefrontTokenFromShop(shop);
  const envToken = storefront.token
    ? null
    : envStorefrontTokenForDevelopmentShop(shop.shopDomain);

  return {
    id: shop.id,
    shopDomain: shop.shopDomain,
    accessToken: shop.accessToken || decryptShopifyToken(shop.accessTokenEncrypted),
    accessTokenEncrypted: shop.accessTokenEncrypted,
    accessTokenDirect: shop.accessToken,
    storefrontAccessToken: storefront.token || envToken,
    storefrontCredentialSource: storefront.token
      ? storefront.source
      : envToken
        ? "env_dev_fallback"
        : "none",
  };
}

export async function getDefaultShopFromConfig() {
  const envDomain = normalizeShopDomain(trimEnv("SHOPIFY_STORE_DOMAIN"));
  if (!envDomain) return null;

  const existing = await getShopByDomain(envDomain);
  if (existing) return existing;

  const envAdminToken = trimEnv("SHOPIFY_ADMIN_ACCESS_TOKEN") || null;
  const envStorefrontToken =
    process.env.NODE_ENV === "production"
      ? null
      : trimEnv("SHOPIFY_STOREFRONT_ACCESS_TOKEN") || null;

  // TODO(multistore): remove env bootstrap fallback once install flow persists shop tokens for every store.
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

  return rows[0] || null;
}

export async function resolveShopConfig(
  preferredShopDomain?: string | null,
  preferredShopId?: string | null
): Promise<ResolvedShopConfig> {
  const normalizedPreferred = normalizeShopDomain(preferredShopDomain);
  const normalizedShopId = String(preferredShopId || "").trim();

  if (normalizedPreferred) {
    const shop = normalizedShopId
      ? await getShopByIdAndDomain(normalizedShopId, normalizedPreferred)
      : await getShopByDomain(normalizedPreferred);

    if (isUsableInstallation(shop)) return resolved(shop as ShopRow);

    // A caller that supplied an explicit shop identity must fail closed rather
    // than falling back to another tenant or the environment default shop.
    return unresolved(normalizedPreferred);
  }

  if (normalizedShopId) return unresolved("");

  const defaultShop = await getDefaultShopFromConfig();
  if (isUsableInstallation(defaultShop)) return resolved(defaultShop as ShopRow);

  const envDomain = normalizeShopDomain(trimEnv("SHOPIFY_STORE_DOMAIN"));
  const envToken = envStorefrontTokenForDevelopmentShop(envDomain);
  return {
    id: null,
    shopDomain: envDomain,
    accessToken: trimEnv("SHOPIFY_ADMIN_ACCESS_TOKEN") || null,
    accessTokenEncrypted: null,
    accessTokenDirect: trimEnv("SHOPIFY_ADMIN_ACCESS_TOKEN") || null,
    storefrontAccessToken: envToken,
    storefrontCredentialSource: envToken ? "env_dev_fallback" : "none",
  };
}
