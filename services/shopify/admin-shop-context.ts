import crypto from "crypto";
import type { NextRequest } from "next/server";
import { getShopByDomain, normalizeShopDomain, type ShopRow } from "./shop";
import { ShopIdentityResolutionError } from "./shop-identity";

export type AdminShopSearchParams = {
  shop?: string | string[];
  shopify_shop?: string | string[];
  host?: string | string[];
  hmac?: string | string[];
  [key: string]: string | string[] | undefined;
};

export type AdminShopResolutionSource = {
  source: "query param" | "session/install context" | "headers";
  attempted: boolean;
  resolved: boolean;
};

export type AdminShopContext = {
  shop: ShopRow | null;
  shopDomain: string;
  error: string | null;
  hmacVerified: boolean;
  resolutionSources: AdminShopResolutionSource[];
};

function firstParam(value: string | string[] | null | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function isInstalledShop(shop: ShopRow | null) {
  return Boolean(shop?.id && shop.isActive && !shop.uninstalledAt && (shop.accessToken || shop.accessTokenEncrypted));
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

function logAdminShopResolutionFailure(
  reason: string,
  details: Record<string, unknown> = {},
) {
  console.warn("[ADMIN SHOP RESOLUTION]", {
    reason,
    ...details,
  });
}

function describeResolutionSources(options: {
  queryAttempted: boolean;
  queryResolved: boolean;
  headerAttempted?: boolean;
  headerResolved?: boolean;
}) {
  return [
    {
      source: "query param" as const,
      attempted: options.queryAttempted,
      resolved: options.queryResolved,
    },
    {
      source: "session/install context" as const,
      attempted: false,
      resolved: false,
    },
    {
      source: "headers" as const,
      attempted: Boolean(options.headerAttempted),
      resolved: Boolean(options.headerResolved),
    },
  ];
}

export function formatAdminShopResolutionError(context: Pick<AdminShopContext, "error" | "resolutionSources">) {
  const sourceSummary = context.resolutionSources
    .map((item) => `${item.source}: ${item.resolved ? "resolved" : item.attempted ? "attempted" : "not available"}`)
    .join("; ");
  return `${context.error || "Unable to resolve shop."} Resolution sources: ${sourceSummary}.`;
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
  return normalizeShopDomain(
    firstParam(params.shop) || firstParam(params.shopify_shop),
  );
}

export async function resolveAdminShopFromSearchParams(
  params: AdminShopSearchParams,
  sourceOptions: { headerAttempted?: boolean; headerResolved?: boolean } = {},
): Promise<AdminShopContext> {
  const shopDomain = getAdminShopDomainFromSearchParams(params);
  const queryAttempted = Boolean(firstParam(params.shop) || firstParam(params.shopify_shop));
  const resolutionSources = describeResolutionSources({
    queryAttempted,
    queryResolved: queryAttempted && Boolean(shopDomain),
    headerAttempted: sourceOptions.headerAttempted,
    headerResolved: sourceOptions.headerResolved,
  });
  if (!shopDomain) {
    logAdminShopResolutionFailure("missing_shop_param", {
      hasShopParam: Boolean(firstParam(params.shop)),
      hasShopifyShopParam: Boolean(firstParam(params.shopify_shop)),
      hasHostParam: Boolean(firstParam(params.host)),
      hasHmac: Boolean(firstParam(params.hmac)),
    });
    return {
      shop: null,
      shopDomain: "",
      error:
        "Unable to resolve shop. Open this page from Shopify admin or add a shop query parameter.",
      hmacVerified: false,
      resolutionSources,
    };
  }

  if (!isValidShopifyShopDomain(shopDomain)) {
    logAdminShopResolutionFailure("invalid_shop_format", { shopDomain });
    return {
      shop: null,
      shopDomain,
      error: "Invalid Shopify shop domain.",
      hmacVerified: false,
      resolutionSources,
    };
  }

  const hmacVerified = firstParam(params.hmac)
    ? validateShopifyHmac(toUrlSearchParams(params))
    : false;
  if (firstParam(params.hmac) && !hmacVerified) {
    logAdminShopResolutionFailure(
      String(process.env.SHOPIFY_API_SECRET || "").trim()
        ? "hmac_invalid"
        : "missing_shopify_api_secret_with_hmac",
      { shopDomain },
    );
    return {
      shop: null,
      shopDomain,
      error:
        "Invalid Shopify admin signature. Reopen this page from Shopify admin.",
      hmacVerified,
      resolutionSources,
    };
  }

  let shop: ShopRow | null = null;
  try {
    shop = await getShopByDomain(shopDomain);
  } catch (error) {
    if (error instanceof ShopIdentityResolutionError) {
      logAdminShopResolutionFailure(error.code, {
        shopDomain,
        status: error.status,
        debugContext: error.debugContext,
      });
      return {
        shop: null,
        shopDomain,
        error: error.message,
        hmacVerified,
        resolutionSources,
      };
    }

    logAdminShopResolutionFailure("database_unavailable", {
      shopDomain,
      error: error instanceof Error ? error.message : "Unknown database error",
    });
    return {
      shop: null,
      shopDomain,
      error: "Unable to verify shop installation. Check database connectivity.",
      hmacVerified,
      resolutionSources,
    };
  }

  if (!shop) {
    logAdminShopResolutionFailure("no_active_shop_row_found", { shopDomain });
    return {
      shop: null,
      shopDomain,
      error:
        "Shop not installed in this database. Reinstall the Shopify app to create the Shop record.",
      hmacVerified,
      resolutionSources,
    };
  }

  if (!isInstalledShop(shop)) {
    logAdminShopResolutionFailure("shop_inactive_or_uninstalled", {
      shopDomain,
      shopId: shop.id,
      isActive: shop.isActive,
      hasUninstalledAt: Boolean(shop.uninstalledAt),
      installationStatus: shop.installationStatus,
    });
    return {
      shop: null,
      shopDomain,
      error:
        "Shop is not installed or active. Please install the app for this shop.",
      hmacVerified,
      resolutionSources,
    };
  }

  return {
    shop,
    shopDomain: shop.shopDomain,
    error: null,
    hmacVerified,
    resolutionSources: describeResolutionSources({
      queryAttempted,
      queryResolved: queryAttempted,
      headerAttempted: sourceOptions.headerAttempted,
      headerResolved: sourceOptions.headerResolved,
    }),
  };
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

  const headerShop = normalizeShopDomain(
    req.headers.get("x-shopify-shop-domain"),
  );
  const usedHeaderShop = !params.shop && !params.shopify_shop && Boolean(headerShop);
  if (usedHeaderShop) params.shop = headerShop;

  return resolveAdminShopFromSearchParams(params, {
    headerAttempted: Boolean(headerShop),
    headerResolved: usedHeaderShop,
  });
}
