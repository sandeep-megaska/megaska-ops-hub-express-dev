import type { NextRequest } from "next/server";
import { prisma } from "../db/prisma";

export type ResolvedShopConfig = {
  id: string | null;
  shopDomain: string;
  accessToken: string | null;
  storefrontAccessToken: string | null;
};

export type ShopRow = {
  id: string;
  shopDomain: string;
  accessToken: string | null;
  storefrontAccessToken: string | null;
  scopes: string | null;
  isActive: boolean;
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

export function normalizeShopDomain(input: string | null | undefined) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function getShopDomainFromRequest(req: NextRequest) {
  const headerDomain = normalizeShopDomain(
    req.headers.get("x-shopify-shop-domain")
  );
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
    `SELECT "id", "shopDomain", "accessToken", "storefrontAccessToken", "scopes", "isActive", "installedAt", "uninstalledAt"
     FROM "Shop"
     WHERE "shopDomain" = $1
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
  const rows = await prisma.$queryRawUnsafe<ShopRow[]>(
    `INSERT INTO "Shop" ("id", "shopDomain", "accessToken", "storefrontAccessToken", "isActive", "installedAt", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, true, NOW(), NOW(), NOW())
     ON CONFLICT ("shopDomain")
     DO UPDATE SET
       "accessToken" = COALESCE(EXCLUDED."accessToken", "Shop"."accessToken"),
       "storefrontAccessToken" = COALESCE(EXCLUDED."storefrontAccessToken", "Shop"."storefrontAccessToken"),
       "isActive" = true,
       "updatedAt" = NOW()
     RETURNING "id", "shopDomain", "accessToken", "storefrontAccessToken", "scopes", "isActive", "installedAt", "uninstalledAt"`,
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
    const shop = await getShopByDomain(normalizedPreferred);
    if (shop) {
      return {
        id: shop.id,
        shopDomain: shop.shopDomain,
        accessToken: shop.accessToken,
        storefrontAccessToken: shop.storefrontAccessToken,
      };
    }
  }

  const defaultShop = await getDefaultShopFromConfig();
  if (defaultShop) {
    return {
      id: defaultShop.id,
      shopDomain: defaultShop.shopDomain,
      accessToken: defaultShop.accessToken,
      storefrontAccessToken: defaultShop.storefrontAccessToken,
    };
  }

  return {
    id: null,
    shopDomain: normalizeShopDomain(trimEnv("SHOPIFY_STORE_DOMAIN")),
    accessToken: trimEnv("SHOPIFY_ADMIN_ACCESS_TOKEN") || null,
    storefrontAccessToken: trimEnv("SHOPIFY_STOREFRONT_ACCESS_TOKEN") || null,
  };
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
