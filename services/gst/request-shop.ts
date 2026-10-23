import type { NextRequest } from "next/server";
import { requireAdminShopFromRequest } from "../shopify/admin-auth";

/**
 * Resolve the acting shop id for a GST admin request from the verified Shopify
 * session token. Returns null when it is missing or invalid — callers MUST fail
 * closed. There is deliberately no fallback to ?shop= / headers / referer: those
 * come from the caller and would let anyone act on another merchant's GST data.
 * The GST admin client (lib/gst-client.ts) attaches the token to every call.
 */
export async function resolveGstAdminShopId(req: NextRequest): Promise<string | null> {
  try {
    const shop = await requireAdminShopFromRequest(req);
    return shop?.id ?? null;
  } catch {
    return null;
  }
}

/** The verified shop's myshopify domain for a GST admin request, or null. */
export async function resolveGstAdminShopDomain(req: NextRequest): Promise<string | null> {
  try {
    const shop = await requireAdminShopFromRequest(req);
    return shop?.shopDomain ?? null;
  } catch {
    return null;
  }
}
