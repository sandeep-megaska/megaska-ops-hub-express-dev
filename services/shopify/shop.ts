import type { NextRequest } from "next/server";
import { prisma } from "../db/prisma";
import { decryptShopifyToken } from "./token-crypto";
import { AmbiguousShopInstallationError, isMyshopifyDomain, normalizeShopDomain, selectCanonicalShopCandidate } from "./shop-identity";
export { isMyshopifyDomain, normalizeShopDomain, selectCanonicalShopCandidate } from "./shop-identity";

export type ResolvedShopConfig = {
  id: string | null;
  shopDomain: string;
  accessToken: string | null;
  storefrontAccessToken: string | null;
  myshopifyDomain?: string | null;
  primaryDomain?: string | null;
};

export type ShopRow = {
  id: string;
  shopDomain: string;
  accessToken: string | null;
  accessTokenEncrypted: string | null;
  storefrontAccessToken: string | null;
  storefrontTokenEncrypted: string | null;
  scopes: string | null;
  isActive: boolean;
  myshopifyDomain: string | null;
  primaryDomain: string | null;
  installationStatus: string | null;
  installedAt: Date | null;
  uninstalledAt: Date | null;
};

export class ShopResolutionError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ShopResolutionError";
    this.status = status;
  }
}

function trimEnv(name: string) {
  return String(process.env[name] || "").trim();
}

function domainFamily(shopDomain: string) {
  return normalizeShopDomain(shopDomain)
    .replace(/^www\./, "")
    .replace(/\.myshopify\.com$/, "");
}

export function getShopDomainFromRequest(req: NextRequest) {
  const url = new URL(req.url);
  const fromEmbeddedQuery = normalizeShopDomain(
    url.searchParams.get("shop") || url.searchParams.get("shopify_shop")
  );
  if (fromEmbeddedQuery) return fromEmbeddedQuery;

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const fromRefererQuery = normalizeShopDomain(
        refererUrl.searchParams.get("shop") ||
          refererUrl.searchParams.get("shopify_shop")
      );
      if (fromRefererQuery) return fromRefererQuery;
    } catch {
      // Ignore malformed referer.
    }
  }

  const headerDomain = normalizeShopDomain(req.headers.get("x-shopify-shop-domain"));
  if (headerDomain) return headerDomain;

  return "";
}


function shopRowToResolved(shop: ShopRow): ResolvedShopConfig {
  return {
    id: shop.id,
    shopDomain: shop.shopDomain,
    myshopifyDomain: shop.myshopifyDomain,
    primaryDomain: shop.primaryDomain,
    accessToken: shop.accessToken || decryptShopifyToken(shop.accessTokenEncrypted),
    storefrontAccessToken: shop.storefrontAccessToken || decryptShopifyToken(shop.storefrontTokenEncrypted),
  };
}

export async function getShopByDomain(shopDomain: string) {
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized) return null;
  const family = domainFamily(normalized);

  const rows = await prisma.$queryRawUnsafe<ShopRow[]>(
    `SELECT "id", "shopDomain", "accessToken", "accessTokenEncrypted", "storefrontAccessToken", "storefrontTokenEncrypted", "scopes", "isActive", "installedAt", "uninstalledAt", "myshopifyDomain", "primaryDomain", "installationStatus"
     FROM "Shop"
     WHERE "shopDomain" = $1
        OR "myshopifyDomain" = $1
        OR "primaryDomain" = $1
        OR replace(regexp_replace(COALESCE("shopDomain", ''), '^www\\.', ''), '.myshopify.com', '') = $2
        OR replace(regexp_replace(COALESCE("myshopifyDomain", ''), '^www\\.', ''), '.myshopify.com', '') = $2
        OR replace(regexp_replace(COALESCE("primaryDomain", ''), '^www\\.', ''), '.myshopify.com', '') = $2
     ORDER BY CASE WHEN "shopDomain" = $1 THEN 0 WHEN "myshopifyDomain" = $1 THEN 1 WHEN "primaryDomain" = $1 THEN 2 ELSE 3 END,
       CASE WHEN "installationStatus" = 'ACTIVE' THEN 0 ELSE 1 END,
       "updatedAt" DESC
     LIMIT 5`,
    normalized,
    family
  );

  try {
    const selected = selectCanonicalShopCandidate(rows, normalized);
    if (rows.length > 1) {
      console.warn("[Shop Resolver] duplicate shop domain candidates", {
        requestedShopDomain: normalized,
        candidateCount: rows.length,
        selectedShopId: selected?.id || null,
        candidates: rows.map((row) => ({
          id: row.id,
          shopDomain: row.shopDomain,
          myshopifyDomain: row.myshopifyDomain,
          primaryDomain: row.primaryDomain,
          isActive: row.isActive,
          installationStatus: row.installationStatus,
          hasAdminAccessToken: Boolean(row.accessToken || row.accessTokenEncrypted),
        })),
      });
    }
    return selected;
  } catch (error) {
    if (error instanceof AmbiguousShopInstallationError) {
      console.warn("[Shop Resolver] ambiguous shop installation", { requestedShopDomain: normalized, candidateIds: rows.map((row) => row.id) });
    }
    throw error instanceof AmbiguousShopInstallationError ? new ShopResolutionError(409, error.message) : error;
  }
}

export async function getDefaultShopFromConfig() {
  const envDomain = normalizeShopDomain(trimEnv("SHOPIFY_STORE_DOMAIN"));
  if (!envDomain) return null;

  const existing = await getShopByDomain(envDomain);
  if (existing) return existing;

  const envAdminToken = trimEnv("SHOPIFY_ADMIN_ACCESS_TOKEN") || null;
  const envStorefrontToken = trimEnv("SHOPIFY_STOREFRONT_ACCESS_TOKEN") || null;

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
     RETURNING "id", "shopDomain", "accessToken", "accessTokenEncrypted", "storefrontAccessToken", "storefrontTokenEncrypted", "scopes", "isActive", "installedAt", "uninstalledAt", "myshopifyDomain", "primaryDomain", "installationStatus"`,
    envDomain,
    envAdminToken,
    envStorefrontToken
  );

  return rows[0] || null;
}

export async function resolveShopConfig(
  preferredShopDomain?: string | null
): Promise<ResolvedShopConfig> {
  const normalizedPreferred = normalizeShopDomain(preferredShopDomain);
  if (normalizedPreferred) {
    const family = domainFamily(normalizedPreferred);
    const rows = await prisma.$queryRawUnsafe<ShopRow[]>(
      `SELECT "id", "shopDomain", "accessToken", "accessTokenEncrypted", "storefrontAccessToken", "storefrontTokenEncrypted", "scopes", "isActive", "installedAt", "uninstalledAt", "myshopifyDomain", "primaryDomain", "installationStatus"
       FROM "Shop"
       WHERE "shopDomain" = $1
          OR "myshopifyDomain" = $1
          OR "primaryDomain" = $1
          OR replace(regexp_replace(COALESCE("shopDomain", ''), '^www\\.', ''), '.myshopify.com', '') = $2
          OR replace(regexp_replace(COALESCE("myshopifyDomain", ''), '^www\\.', ''), '.myshopify.com', '') = $2
          OR replace(regexp_replace(COALESCE("primaryDomain", ''), '^www\\.', ''), '.myshopify.com', '') = $2`,
      normalizedPreferred,
      family
    );
    try {
      const canonicalShop = selectCanonicalShopCandidate(rows, normalizedPreferred);
      if (canonicalShop) return shopRowToResolved(canonicalShop);
    } catch (error) {
      if (error instanceof AmbiguousShopInstallationError) {
        console.warn("[Shop Resolver] ambiguous shop installation", { requestedShopDomain: normalizedPreferred, candidateIds: rows.map((row) => row.id) });
      }
      throw error instanceof AmbiguousShopInstallationError ? new ShopResolutionError(409, error.message) : error;
    }
    if (rows.length) {
      console.warn("[Shop Resolver] unable to select canonical shop installation", { requestedShopDomain: normalizedPreferred, candidateIds: rows.map((row) => row.id) });
      throw new ShopResolutionError(409, "ambiguous_shop_installation");
    }
  }

  const defaultShop = await getDefaultShopFromConfig();
  if (defaultShop) {
    return shopRowToResolved(defaultShop);
  }

  const envShopDomain = normalizeShopDomain(trimEnv("SHOPIFY_STORE_DOMAIN"));
  return {
    id: null,
    shopDomain: envShopDomain,
    myshopifyDomain: isMyshopifyDomain(envShopDomain) ? envShopDomain : null,
    primaryDomain: null,
    accessToken: trimEnv("SHOPIFY_ADMIN_ACCESS_TOKEN") || null,
    storefrontAccessToken: trimEnv("SHOPIFY_STOREFRONT_ACCESS_TOKEN") || null,
  };
}

function isAllowedDevStorefrontFallback(shopDomain: string) {
  if (process.env.NODE_ENV === "production") return false;
  if (String(process.env.EXPRESS_CHECKOUT_ENABLED || "").toLowerCase() !== "true") return false;

  const normalizedShopDomain = normalizeShopDomain(shopDomain);
  if (!normalizedShopDomain) return false;

  return String(process.env.EXPRESS_CHECKOUT_ALLOWED_SHOPS || "")
    .split(",")
    .map((shop) => normalizeShopDomain(shop))
    .filter(Boolean)
    .includes(normalizedShopDomain);
}

export async function requireStorefrontShopFromRequest(req: NextRequest): Promise<ShopRow> {
  const shopDomain = getShopDomainFromRequest(req);

  if (!shopDomain) {
    throw new ShopResolutionError(400, "Missing shop domain in request");
  }

  const shop = await getShopByDomain(shopDomain);

  if (shop?.isActive && !shop.uninstalledAt) {
    return shop;
  }

  if (isAllowedDevStorefrontFallback(shopDomain)) {
    const fallbackShop = await getDefaultShopFromConfig();
    if (fallbackShop?.isActive && !fallbackShop.uninstalledAt) return fallbackShop;
  }

  if (!shop) {
    throw new ShopResolutionError(404, "Shop not found");
  }

  throw new ShopResolutionError(403, "Shop is inactive");
}

/**
 * STRICT resolver for auth / OTP / customer session flows.
 * This does NOT fallback to env default shop, because that is unsafe in multi-store flows.
 */
export async function requireShopFromRequest(req: NextRequest): Promise<ShopRow> {
  const shopDomain = getShopDomainFromRequest(req);

  if (!shopDomain) {
    throw new ShopResolutionError(400, "Missing shop domain in request");
  }

  const shop = await getShopByDomain(shopDomain);

  if (!shop) {
    throw new ShopResolutionError(404, "Shop not found");
  }

  if (!shop.isActive || shop.uninstalledAt) {
    throw new ShopResolutionError(403, "Shop is inactive");
  }

  return shop;
}
