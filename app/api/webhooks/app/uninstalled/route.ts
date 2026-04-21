import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { normalizeShopDomain } from "../../../../../services/shopify/shop-resolver";

export const runtime = "nodejs";

function getShopifyWebhookSecret() {
  return String(process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET || "").trim();
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function verifyWebhookHmac(rawBuffer: Buffer, hmacHeader: string) {
  const secret = getShopifyWebhookSecret();
  if (!secret || !hmacHeader) return false;

  const digest = crypto.createHmac("sha256", secret).update(rawBuffer).digest("base64");
  return safeEqual(digest, hmacHeader);
}

export async function POST(req: NextRequest) {
  const rawBuffer = Buffer.from(await req.arrayBuffer());
  const hmacHeader = String(req.headers.get("x-shopify-hmac-sha256") || "").trim();

  if (!verifyWebhookHmac(rawBuffer, hmacHeader)) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  const shopDomain = normalizeShopDomain(req.headers.get("x-shopify-shop-domain"));
  if (!shopDomain) {
    return NextResponse.json({ ok: true, skipped: true, reason: "missing-shop-domain" });
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "Shop"
     SET "isActive" = false,
         "uninstalledAt" = NOW(),
         "updatedAt" = NOW()
     WHERE "shopDomain" = $1`,
    shopDomain
  );

  return NextResponse.json({ ok: true, shopDomain, deactivated: true });
}
