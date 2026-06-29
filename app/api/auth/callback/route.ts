import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "../../../../services/db/prisma";
import { encryptShopifyToken } from "../../../../services/shopify/token-crypto";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL!;
const SHOPIFY_API_VERSION = "2026-01";

function isValidShop(shop: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

function normalizeShopDomain(input: string | null | undefined) {
  return String(input || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
}

function validateHmac(params: URLSearchParams, secret: string) {
  const hmac = params.get("hmac") || "";
  const entries = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b));

  const message = entries.map(([key, value]) => `${key}=${value}`).join("&");
  const generated = crypto.createHmac("sha256", secret).update(message).digest("hex");

  if (generated.length !== hmac.length) return false;
  return crypto.timingSafeEqual(Buffer.from(generated, "utf8"), Buffer.from(hmac, "utf8"));
}

async function fetchShopMetadata(shop: string, accessToken: string) {
  const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({
      query: `query MegaskaShopInstallMetadata { shop { name myshopifyDomain primaryDomain { host url } } }`,
    }),
  });

  if (!response.ok) return { shopName: null, myshopifyDomain: shop, primaryDomain: null };

  const payload = await response.json().catch(() => null) as {
    data?: { shop?: { name?: string | null; myshopifyDomain?: string | null; primaryDomain?: { host?: string | null; url?: string | null } | null } };
  } | null;
  const metadata = payload?.data?.shop;
  const primaryDomain = normalizeShopDomain(metadata?.primaryDomain?.host || metadata?.primaryDomain?.url || "") || null;

  return {
    shopName: String(metadata?.name || "").trim() || null,
    myshopifyDomain: normalizeShopDomain(metadata?.myshopifyDomain || shop) || shop,
    primaryDomain,
  };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const shop = normalizeShopDomain(params.get("shop"));
  const code = String(params.get("code") || "").trim();
  const state = String(params.get("state") || "").trim();
  const savedState = request.cookies.get("shopify_oauth_state")?.value || "";

  if (!shop || !code || !state || !isValidShop(shop)) {
    return NextResponse.json({ error: "Missing or invalid OAuth params" }, { status: 400 });
  }

  if (!savedState || savedState !== state) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  if (!validateHmac(params, SHOPIFY_API_SECRET)) {
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 400 });
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return NextResponse.json({ error: "Token exchange failed", details: text }, { status: 500 });
  }

  const tokenData = await tokenRes.json();
  const accessToken = String(tokenData.access_token || "").trim();
  const scopes = String(tokenData.scope || tokenData.scopes || "").trim() || null;

  if (!accessToken) return NextResponse.json({ error: "No access token returned" }, { status: 500 });

  const metadata = await fetchShopMetadata(shop, accessToken);
  const encryptedAccessToken = encryptShopifyToken(accessToken);
  const appProxyEnabled = Boolean(process.env.SHOPIFY_APP_PROXY_PREFIX || process.env.SHOPIFY_APP_PROXY_SUBPATH || process.env.SHOPIFY_APP_URL);
  const checkoutEnabled = shop === "megaskastore.myshopify.com" || String(process.env.EXPRESS_CHECKOUT_ENABLED || "").toLowerCase() === "true";

  const rows = await prisma.$queryRaw<{ id: string; installationStatus: string | null; myshopifyDomain: string | null; hasAccessToken: boolean }[]>`
    INSERT INTO "Shop" (
      "id", "shopDomain", "accessToken", "accessTokenEncrypted", "scopes", "isActive", "installedAt", "uninstalledAt",
      "createdAt", "updatedAt", "myshopifyDomain", "primaryDomain", "shopName", "appProxyEnabled", "checkoutEnabled", "installationStatus"
    )
    VALUES (
      gen_random_uuid()::text, ${shop}, ${accessToken}, ${encryptedAccessToken}, ${scopes}, true, NOW(), NULL,
      NOW(), NOW(), ${metadata.myshopifyDomain}, ${metadata.primaryDomain}, ${metadata.shopName}, ${appProxyEnabled}, ${checkoutEnabled}, 'ACTIVE'
    )
    ON CONFLICT ("shopDomain") DO UPDATE SET
      "accessToken" = EXCLUDED."accessToken",
      "accessTokenEncrypted" = EXCLUDED."accessTokenEncrypted",
      "scopes" = EXCLUDED."scopes",
      "isActive" = true,
      "installedAt" = NOW(),
      "uninstalledAt" = NULL,
      "updatedAt" = NOW(),
      "myshopifyDomain" = EXCLUDED."myshopifyDomain",
      "primaryDomain" = EXCLUDED."primaryDomain",
      "shopName" = EXCLUDED."shopName",
      "appProxyEnabled" = EXCLUDED."appProxyEnabled",
      "checkoutEnabled" = EXCLUDED."checkoutEnabled",
      "installationStatus" = 'ACTIVE'
    RETURNING "id", "installationStatus", "myshopifyDomain", ("accessToken" IS NOT NULL OR "accessTokenEncrypted" IS NOT NULL) AS "hasAccessToken"
  `;

  const persisted = rows[0];
  console.info("[SHOPIFY OAUTH CALLBACK] shop persisted", {
    resolvedShopId: persisted?.id || null,
    requestShop: shop,
    myshopifyDomain: persisted?.myshopifyDomain || metadata.myshopifyDomain,
    installationStatus: persisted?.installationStatus || "ACTIVE",
    hasAccessToken: Boolean(persisted?.hasAccessToken),
    scopes,
  });

  return NextResponse.redirect(`${SHOPIFY_APP_URL}/?shop=${encodeURIComponent(shop)}`);
}
