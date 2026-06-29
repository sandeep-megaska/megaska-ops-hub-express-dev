import crypto from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "../db/prisma";
import { normalizeShopDomain } from "./shop-resolver";

type AppProxyShop = {
  id: string;
  shopDomain: string;
  myshopifyDomain: string | null;
  installationStatus: string | null;
  accessTokenEncrypted: string | null;
  accessToken: string | null;
};

export class AppProxyError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppProxyError";
    this.status = status;
  }
}

const ACTIVE_MODULE_KEYS = new Set([
  "dashboard",
  "gst",
  "exchanges",
  "cancellations",
  "issues",
  "express_checkout",
  "otp_auth",
  "bag",
  "pincode",
  "exchange_hook",
]);

function getShopifyApiSecret() {
  return String(process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_API_SECRET_KEY || "").trim();
}

function timingSafeEqualHex(left: string, right: string) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildSignatureMessage(searchParams: URLSearchParams) {
  const pairs: string[] = [];
  searchParams.forEach((value, key) => {
    if (key === "signature" || key === "hmac") return;
    pairs.push(`${key}=${value}`);
  });
  return pairs.sort().join("");
}

function isAllowedDevProxyBypass(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return false;
  if (String(process.env.EXPRESS_CHECKOUT_ENABLED || "").toLowerCase() !== "true") return false;

  const requestedShop = normalizeShopDomain(new URL(request.url).searchParams.get("shop"));
  if (!requestedShop) return false;

  const allowedShops = String(process.env.EXPRESS_CHECKOUT_ALLOWED_SHOPS || "")
    .split(",")
    .map((shop) => normalizeShopDomain(shop))
    .filter(Boolean);

  return allowedShops.includes(requestedShop);
}

export function verifyShopifyAppProxySignature(request: NextRequest) {
  const url = new URL(request.url);
  const providedSignature = String(url.searchParams.get("signature") || "").trim();
  const secret = getShopifyApiSecret();

  if (providedSignature && secret) {
    const digest = crypto.createHmac("sha256", secret).update(buildSignatureMessage(url.searchParams)).digest("hex");
    if (timingSafeEqualHex(digest, providedSignature)) return true;
  }

  if (isAllowedDevProxyBypass(request)) return true;

  return false;
}

export async function resolveShopFromAppProxyRequest(request: NextRequest): Promise<AppProxyShop | null> {
  if (!verifyShopifyAppProxySignature(request)) return null;

  const requestedShop = normalizeShopDomain(new URL(request.url).searchParams.get("shop"));
  if (!requestedShop) return null;

  const rows = await prisma.$queryRaw<AppProxyShop[]>`
    SELECT "id", "shopDomain", "myshopifyDomain", "installationStatus", "accessTokenEncrypted", "accessToken"
    FROM "Shop"
    WHERE ("shopDomain" = ${requestedShop}
       OR "myshopifyDomain" = ${requestedShop})
      AND "installationStatus" = 'ACTIVE'
      AND "isActive" = true
      AND "uninstalledAt" IS NULL
    ORDER BY "updatedAt" DESC
    LIMIT 1
  `;

  return rows[0] || null;
}

export async function requireShopFromAppProxy(request: NextRequest): Promise<AppProxyShop> {
  if (!verifyShopifyAppProxySignature(request)) {
    throw new AppProxyError("Invalid Shopify app proxy signature", 401);
  }

  const shop = await resolveShopFromAppProxyRequest(request);
  if (!shop) throw new AppProxyError("No active Shopify installation found. Please reinstall the app.", 404);
  return shop;
}

export async function requireEnabledModule(shopId: string, moduleKey: string) {
  if (!ACTIVE_MODULE_KEYS.has(moduleKey)) {
    throw new AppProxyError("Module is not available through the Megaska app proxy", 404);
  }

  const config = await prisma.shopModuleConfig.findUnique({
    where: { shopId_moduleKey: { shopId, moduleKey } },
    select: { enabled: true },
  });

  if (config && !config.enabled) {
    throw new AppProxyError("Module is disabled for this shop", 403);
  }

  return true;
}

export function appProxyJsonError(error: unknown) {
  const status = error instanceof AppProxyError ? error.status : 500;
  const message = error instanceof Error ? error.message : "App proxy request failed";
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function appProxyHtmlError(error: unknown) {
  const status = error instanceof AppProxyError ? error.status : 500;
  const message = error instanceof Error ? error.message : "App proxy request failed";
  return new NextResponse(`<!doctype html><html><body><h1>Megaska is unavailable</h1><p>${message}</p></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
