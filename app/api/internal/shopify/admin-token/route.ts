import { NextRequest, NextResponse } from "next/server";
import { validateShopifyAdminToken } from "../../../../../services/express-checkout/shopify-admin";
import { normalizeShopDomain } from "../../../../../services/shopify/shop";

export const runtime = "nodejs";

function getDiagnosticSecret() {
  return String(process.env.SHOPIFY_ADMIN_DIAGNOSTIC_SECRET || process.env.INTERNAL_DIAGNOSTIC_SECRET || "").trim();
}

function isAuthorized(req: NextRequest) {
  const requiredSecret = getDiagnosticSecret();
  if (!requiredSecret) return true;

  return req.headers.get("x-diagnostic-secret") === requiredSecret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const shopDomain = normalizeShopDomain(url.searchParams.get("shop") || process.env.SHOPIFY_STORE_DOMAIN || "");

  if (!shopDomain) {
    return NextResponse.json({ ok: false, error: "shop query parameter is required" }, { status: 400 });
  }

  try {
    const data = await validateShopifyAdminToken(shopDomain);
    return NextResponse.json({ ok: true, shop: data.shop || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify Admin token validation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
