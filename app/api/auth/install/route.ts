import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

function getTrimmedEnv(name: string) {
  return String(process.env[name] || "").trim();
}

function getInstallEnv() {
  const env = {
    SHOPIFY_API_KEY: getTrimmedEnv("SHOPIFY_API_KEY"),
    SHOPIFY_API_SECRET: getTrimmedEnv("SHOPIFY_API_SECRET"),
    SHOPIFY_APP_URL: getTrimmedEnv("SHOPIFY_APP_URL").replace(/\/+$/, ""),
    SHOPIFY_SCOPES: getTrimmedEnv("SHOPIFY_SCOPES") || "read_customers",
    DATABASE_URL: getTrimmedEnv("DATABASE_URL"),
  };

  const missing = Object.entries(env)
    .filter(([key, value]) => key !== "DATABASE_URL" && !value)
    .map(([key]) => key);

  const invalid: string[] = [];
  if (env.SHOPIFY_APP_URL) {
    try {
      const appUrl = new URL(env.SHOPIFY_APP_URL);
      if (!["https:", "http:"].includes(appUrl.protocol)) invalid.push("SHOPIFY_APP_URL");
    } catch {
      invalid.push("SHOPIFY_APP_URL");
    }
  }

  return { env, missing, invalid };
}

function getUrlHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function isValidShop(shop: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const shop = String(url.searchParams.get("shop") || "").trim().toLowerCase();
    const { env, missing, invalid } = getInstallEnv();

    console.info("[SHOPIFY OAUTH INSTALL] env validation", {
      hasShopifyApiKey: Boolean(env.SHOPIFY_API_KEY),
      hasShopifyApiSecret: Boolean(env.SHOPIFY_API_SECRET),
      hasShopifyAppUrl: Boolean(env.SHOPIFY_APP_URL),
      hasShopifyScopes: Boolean(env.SHOPIFY_SCOPES),
      hasDatabaseUrl: Boolean(env.DATABASE_URL),
      shopifyAppUrlHost: getUrlHost(env.SHOPIFY_APP_URL),
      shopifyScopesCount: env.SHOPIFY_SCOPES.split(",").filter(Boolean).length,
      missing,
      invalid,
    });

    if (missing.length || invalid.length) {
      console.error("[SHOPIFY OAUTH INSTALL] configuration validation failed", { missing, invalid });
      return NextResponse.json(
        { error: "Shopify OAuth install is not configured correctly", missing, invalid },
        { status: 500 }
      );
    }

    const validShop = Boolean(shop && isValidShop(shop));
    console.info("[SHOPIFY OAUTH INSTALL] shop validation", { shop, validShop });

    if (!validShop) {
      return NextResponse.json({ error: "Invalid shop" }, { status: 400 });
    }

    const state = crypto.randomBytes(16).toString("hex");
    const redirectUri = `${env.SHOPIFY_APP_URL}/api/auth/callback`;

    const installUrl =
      `https://${shop}/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(env.SHOPIFY_API_KEY)}` +
      `&scope=${encodeURIComponent(env.SHOPIFY_SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;

    const oauthUrl = new URL(installUrl);
    console.info("[SHOPIFY OAUTH INSTALL] OAuth URL generated", {
      shop,
      oauthHost: oauthUrl.host,
      redirectUriHost: new URL(redirectUri).host,
      scopesCount: env.SHOPIFY_SCOPES.split(",").filter(Boolean).length,
    });

    const response = NextResponse.redirect(oauthUrl);
    response.cookies.set("shopify_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[SHOPIFY OAUTH INSTALL] failed before Shopify redirect", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "Shopify OAuth install failed before redirect" }, { status: 500 });
  }
}
