import type { NextRequest } from "next/server";
import { getShopByDomain, ShopResolutionError, type ShopRow } from "./shop";
import { SessionTokenError, verifyShopifySessionToken } from "./session-token";

/**
 * Secure resolver for embedded-admin API routes reached via App Bridge `fetch`.
 *
 * It REQUIRES a verified Shopify session token in the `Authorization: Bearer`
 * header and derives the shop from the token's `dest` claim — it never trusts a
 * client-supplied `?shop=` param, header, or referer. Use this in place of
 * `requireShopFromRequest`/`resolveShopConfig(getShopDomainFromRequest(...))` on
 * every route that mutates or reads a single tenant's admin data.
 *
 * Throws ShopResolutionError(401) when the token is missing/invalid so callers
 * can map it to a 401 response.
 */
export async function requireAdminShopFromRequest(req: NextRequest): Promise<ShopRow> {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    throw new ShopResolutionError(401, "Missing Shopify session token");
  }

  let verified;
  try {
    verified = verifyShopifySessionToken(token);
  } catch (error) {
    const message = error instanceof SessionTokenError ? error.message : "Invalid session token";
    throw new ShopResolutionError(401, message);
  }

  const shop = await getShopByDomain(verified.shopDomain);
  if (!shop) {
    throw new ShopResolutionError(404, "Shop not found");
  }
  if (!shop.isActive || shop.uninstalledAt) {
    throw new ShopResolutionError(403, "Shop is inactive");
  }

  return shop;
}
