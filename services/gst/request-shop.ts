import type { NextRequest } from "next/server";
import { requireAdminShopFromRequest } from "../shopify/admin-auth";
import { getShopDomainFromRequest, resolveShopConfig } from "../shopify/shop";

/**
 * Resolve the acting shop id for a GST admin request.
 *
 * Prefers the verified Shopify session token (the secure path). Falls back to
 * the request's shop domain (?shop= / headers / referer) for the legacy GST
 * client calls that do not yet attach the token. Returns null when neither
 * resolves — callers MUST fail closed (never fall back to a global scope; that
 * is exactly the cross-tenant leak this replaces).
 */
export async function resolveGstAdminShopId(req: NextRequest): Promise<string | null> {
  try {
    const shop = await requireAdminShopFromRequest(req);
    if (shop?.id) return shop.id;
  } catch {
    // No / invalid session token — fall back to the request's shop domain.
  }

  const domain = getShopDomainFromRequest(req);
  if (!domain) return null;

  const resolved = await resolveShopConfig(domain);
  return resolved.id ?? null;
}
