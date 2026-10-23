import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { normalizeShopDomain } from "../../../../../services/shopify/shop-resolver";
import { verifyShopifyWebhookHmac } from "../../../../../services/shopify/webhook-hmac";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rawBuffer = Buffer.from(await req.arrayBuffer());
  const hmacHeader = String(req.headers.get("x-shopify-hmac-sha256") || "").trim();

  if (!verifyShopifyWebhookHmac(rawBuffer, hmacHeader)) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  const shopDomain = normalizeShopDomain(req.headers.get("x-shopify-shop-domain"));
  if (!shopDomain) {
    return NextResponse.json({ ok: true, skipped: true, reason: "missing-shop-domain" });
  }

  // Shopify revokes the app's tokens on uninstall; drop our copies too. Opening the app
  // again after a reinstall exchanges a fresh token (services/shopify/install.ts).
  await prisma.$executeRawUnsafe(
    `UPDATE "Shop"
     SET "isActive" = false,
         "uninstalledAt" = NOW(),
         "installationStatus" = 'UNINSTALLED',
         "accessToken" = NULL,
         "accessTokenEncrypted" = NULL,
         "storefrontAccessToken" = NULL,
         "storefrontTokenEncrypted" = NULL,
         "updatedAt" = NOW()
     WHERE "shopDomain" = $1`,
    shopDomain
  );

  return NextResponse.json({ ok: true, shopDomain, deactivated: true });
}
