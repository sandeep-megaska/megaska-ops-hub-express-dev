import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { validateShopifyAdminToken } from "../../../../../services/express-checkout/shopify-admin";
import { normalizeShopDomain } from "../../../../../services/shopify/shop";

export const runtime = "nodejs";

function getDiagnosticSecret() {
  return String(process.env.SHOPIFY_ADMIN_DIAGNOSTIC_SECRET || process.env.INTERNAL_DIAGNOSTIC_SECRET || "").trim();
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function isAuthorized(req: NextRequest) {
  const requiredSecret = getDiagnosticSecret();
  // Fail closed: a missing diagnostic secret must NOT open the route. Previously
  // this returned true when unset, so a prod deploy that forgot the secret
  // exposed the internal Shopify-admin-token probe to anyone.
  if (!requiredSecret) return false;

  return timingSafeEqualStr(String(req.headers.get("x-diagnostic-secret") || ""), requiredSecret);
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
