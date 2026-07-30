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
      query: `query LoopDeskShopInstallMetadata { shop { name myshopifyDomain primaryDomain { host url } } }`,
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
  // The admin token is persisted encrypted-at-rest only; we never write the
  // plaintext column. The encryption key derives from SHOPIFY_API_SECRET (used
  // for the token exchange just above), so a null here means a misconfigured
  // key — fail the install rather than fall back to storing plaintext.
  if (!encryptedAccessToken) {
    console.error("[SHOPIFY OAUTH CALLBACK] token encryption unavailable; refusing to persist plaintext", { requestShop: shop });
    return NextResponse.json({ error: "Token encryption is not configured" }, { status: 500 });
  }
  const appProxyEnabled = Boolean(process.env.SHOPIFY_APP_PROXY_PREFIX || process.env.SHOPIFY_APP_PROXY_SUBPATH || process.env.SHOPIFY_APP_URL);
  // Installation never depends on a deployment allowlist. Tenant module settings and
  // Razorpay readiness are the runtime authorities for Express Checkout.
  const checkoutEnabled = false;

  const shopId = crypto.randomUUID();

  let rows: { id: string; installationStatus: string | null; myshopifyDomain: string | null; hasAccessToken: boolean }[];
  try {
    console.info("[SHOPIFY OAUTH CALLBACK] persisting shop installation", {
      requestShop: shop,
      myshopifyDomain: metadata.myshopifyDomain,
      hasMetadata: Boolean(metadata.shopName || metadata.primaryDomain),
      scopesCount: scopes?.split(",").filter(Boolean).length || 0,
    });

    rows = await prisma.$queryRaw<{ id: string; installationStatus: string | null; myshopifyDomain: string | null; hasAccessToken: boolean }[]>`
    INSERT INTO "Shop" (
      "id", "shopDomain", "accessToken", "accessTokenEncrypted", "scopes", "isActive", "installedAt", "uninstalledAt",
      "createdAt", "updatedAt", "myshopifyDomain", "primaryDomain", "shopName", "appProxyEnabled", "checkoutEnabled", "installationStatus"
    )
    VALUES (
      ${shopId}, ${shop}, NULL, ${encryptedAccessToken}, ${scopes}, true, NOW(), NULL,
      NOW(), NOW(), ${metadata.myshopifyDomain}, ${metadata.primaryDomain}, ${metadata.shopName}, ${appProxyEnabled}, ${checkoutEnabled}, 'ACTIVE'
    )
    ON CONFLICT ("shopDomain") DO UPDATE SET
      "accessToken" = NULL,
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
  } catch (error) {
    console.error("[SHOPIFY OAUTH CALLBACK] shop persistence failed after token exchange", {
      requestShop: shop,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Shop installation could not be persisted", shop },
      { status: 500 },
    );
  }

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
