import crypto from "crypto";
import type { NextRequest } from "next/server";
import { getShopByDomain, normalizeShopDomain, type ShopRow } from "./shop";

export type AdminShopSearchParams = {
  shop?: string | string[];
  shopify_shop?: string | string[];
  host?: string | string[];
  hmac?: string | string[];
  [key: string]: string | string[] | undefined;
};

export type AdminShopContext = {
  shop: ShopRow | null;
  shopDomain: string;
  error: string | null;
  hmacVerified: boolean;
};

function firstParam(value: string | string[] | null | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function isInstalledShop(shop: ShopRow | null): shop is ShopRow {
  return Boolean(shop?.id && shop.isActive && !shop.uninstalledAt);
}

function isValidShopifyShopDomain(shopDomain: string) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain);
}

function validateShopifyHmac(params: URLSearchParams) {
  const secret = String(process.env.SHOPIFY_API_SECRET || "").trim();
  const hmac = params.get("hmac") || "";
  if (!secret || !hmac) return false;

  const entries = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b));
  const message = entries.map(([key, value]) => `${key}=${value}`).join("&");
  const generated = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  if (generated.length !== hmac.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(generated, "utf8"),
    Buffer.from(hmac, "utf8"),
  );
}

function toUrlSearchParams(params: AdminShopSearchParams) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => searchParams.append(key, item));
    } else if (value !== undefined) {
      searchParams.set(key, value);
    }
  });
  return searchParams;
}

export function getAdminShopDomainFromSearchParams(
  params: AdminShopSearchParams,
) {
  return normalizeShopDomain(firstParam(params.shop) || firstParam(params.shopify_shop));
}

export async function resolveAdminShopFromSearchParams(
  params: AdminShopSearchParams,
): Promise<AdminShopContext> {
  const shopDomain = getAdminShopDomainFromSearchParams(params);
  if (!shopDomain) {
    return {
      shop: null,
      shopDomain: "",
      error: "Unable to resolve shop. Open this page from Shopify admin or add a shop query parameter.",
      hmacVerified: false,
    };
  }

  if (!isValidShopifyShopDomain(shopDomain)) {
    return {
      shop: null,
      shopDomain,
      error: "Invalid Shopify shop domain.",
      hmacVerified: false,
    };
  }

  const hmacVerified = firstParam(params.hmac)
    ? validateShopifyHmac(toUrlSearchParams(params))
    : false;
  if (firstParam(params.hmac) && !hmacVerified) {
    return {
      shop: null,
      shopDomain,
      error: "Invalid Shopify admin signature. Reopen this page from Shopify admin.",
      hmacVerified,
    };
  }

  const shop = await getShopByDomain(shopDomain);
  if (!isInstalledShop(shop)) {
    return {
      shop: null,
      shopDomain,
      error: "Shop is not installed or active. Please install the app for this shop.",
      hmacVerified,
    };
  }

  return { shop, shopDomain: shop.shopDomain, error: null, hmacVerified };
}

export async function resolveAdminShopFromRequest(
  req: NextRequest,
): Promise<AdminShopContext> {
  const url = new URL(req.url);
  const params: AdminShopSearchParams = {};
  url.searchParams.forEach((value, key) => {
    const existing = params[key];
    if (Array.isArray(existing)) existing.push(value);
    else if (existing !== undefined) params[key] = [existing, value];
    else params[key] = value;
  });

  const headerShop = normalizeShopDomain(req.headers.get("x-shopify-shop-domain"));
  if (!params.shop && !params.shopify_shop && headerShop) params.shop = headerShop;

  return resolveAdminShopFromSearchParams(params);
}
