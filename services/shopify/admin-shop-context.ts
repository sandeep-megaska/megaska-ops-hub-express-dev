import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { normalizeShopDomain, ShopResolutionError, type ShopRow } from "./shop";
import { requireAdminShopFromRequest } from "./admin-auth";
import { sessionBounceUrl, verifyAdminRequest } from "./admin-request-auth";
import { ensureShopInstalled } from "./install";
import { shopNeedsInstall } from "./token-exchange";

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
  return Boolean(shop?.id && shop.isActive && !shop.uninstalledAt);
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

// The middleware forwards the URL of the page (or server action) being rendered.
export const ADMIN_REQUEST_URL_HEADER = "x-loopd2c-url";

async function readRequestHeaders() {
  try {
    return await headers();
  } catch {
    return null;
  }
}

// SECURITY: the shop always comes from something Shopify signed (a session token on
// the request, the app-load id_token, or the app-load HMAC) — see admin-request-auth.ts.
// A ?shop= param on its own is only checked against it, never trusted. When the
// request can't be verified, a page render or server action is sent to the session
// bounce page, which gets a fresh token from App Bridge and reloads.
export async function resolveAdminShopFromSearchParams(
  params: AdminShopSearchParams,
  sourceOptions: { headerAttempted?: boolean; headerResolved?: boolean } = {},
): Promise<AdminShopContext> {
  const requestedShopDomain = getAdminShopDomainFromSearchParams(params);
  const queryAttempted = Boolean(firstParam(params.shop) || firstParam(params.shopify_shop));
  const resolutionSources = describeResolutionSources({
    queryAttempted,
    queryResolved: queryAttempted && Boolean(requestedShopDomain),
    headerAttempted: sourceOptions.headerAttempted,
    headerResolved: sourceOptions.headerResolved,
  });

  const requestHeaders = await readRequestHeaders();
  const verification = verifyAdminRequest({
    authorization: requestHeaders?.get("authorization"),
    params: toUrlSearchParams(params),
  });

  if (!verification.ok) {
    logAdminShopResolutionFailure("unverified_admin_request", {
      reason: verification.reason,
      requestedShopDomain,
    });
    const bounce = sessionBounceUrl(requestHeaders?.get(ADMIN_REQUEST_URL_HEADER));
    if (bounce) redirect(bounce);
    return {
      shop: null,
      shopDomain: "",
      error: "Your Shopify session could not be verified. Reopen LoopD2C from Shopify admin.",
      hmacVerified: false,
      resolutionSources,
    };
  }

  if (requestedShopDomain && requestedShopDomain !== verification.shopDomain) {
    logAdminShopResolutionFailure("shop_param_mismatch", {
      requestedShopDomain,
      verifiedShopDomain: verification.shopDomain,
    });
    return {
      shop: null,
      shopDomain: "",
      error: "This page belongs to a different shop. Reopen LoopD2C from Shopify admin.",
      hmacVerified: false,
      resolutionSources,
    };
  }

  const shopDomain = verification.shopDomain;
  const hmacVerified = true;

  // First open after install (or reinstall): swap the verified session token for an
  // offline token and create/reactivate the Shop row. An HMAC-only app load has no
  // token to exchange, so a shop that still needs installing is bounced to get one.
  let shop: ShopRow | null = null;
  try {
    shop = await ensureShopInstalled(shopDomain, verification.sessionToken ?? null);
  } catch (error) {
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

  if (shopNeedsInstall(shop) && !verification.sessionToken) {
    const bounce = sessionBounceUrl(requestHeaders?.get(ADMIN_REQUEST_URL_HEADER));
    if (bounce) redirect(bounce);
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

// SECURITY: /api/admin/** routes are reached only by embedded-admin client fetches,
// which carry an App Bridge session token. Require and verify that token and derive the
// shop from its `dest` claim — never trust a client-supplied ?shop= / x-shopify-shop-domain,
// which a caller could forge to read or mutate another tenant's data. Returns the same
// AdminShopContext shape (shop: null + error on failure) so existing callers keep their
// 401 handling unchanged.
export async function resolveAdminShopFromRequest(
  req: NextRequest,
): Promise<AdminShopContext> {
  try {
    const shop = await requireAdminShopFromRequest(req);
    return {
      shop,
      shopDomain: shop.shopDomain,
      error: null,
      hmacVerified: true,
      resolutionSources: describeResolutionSources({ queryAttempted: false, queryResolved: false }),
    };
  } catch (error) {
    const message = error instanceof ShopResolutionError ? error.message : "Missing or invalid Shopify session token";
    logAdminShopResolutionFailure("session_token_required", { message });
    return {
      shop: null,
      shopDomain: "",
      error: "Unauthorized. Reopen this page from Shopify admin.",
      hmacVerified: false,
      resolutionSources: describeResolutionSources({ queryAttempted: false, queryResolved: false }),
    };
  }
}
