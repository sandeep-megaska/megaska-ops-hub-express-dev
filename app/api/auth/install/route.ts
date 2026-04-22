import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL!;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || "read_customers";

function isValidShop(shop: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const shop = String(url.searchParams.get("shop") || "").trim();

  if (!shop || !isValidShop(shop)) {
    return NextResponse.json({ error: "Invalid shop" }, { status: 400 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${SHOPIFY_APP_URL}/api/auth/callback`;

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(SHOPIFY_API_KEY)}` +
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  const response = NextResponse.redirect(installUrl);
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  return response;
}
