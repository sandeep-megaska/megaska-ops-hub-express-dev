import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL!;

function isValidShop(shop: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shop = String(searchParams.get("shop") || "").trim();

  if (!shop || !isValidShop(shop)) {
    return NextResponse.json({ error: "Invalid shop parameter" }, { status: 400 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${SHOPIFY_APP_URL}/api/auth/callback`;

  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(SHOPIFY_API_KEY)}` +
    `&scope=${encodeURIComponent(
      "read_all_orders,read_customers,write_customers,read_discounts,write_discounts,write_metaobject_definitions,read_orders,write_orders,read_products,write_products,unauthenticated_write_checkouts,unauthenticated_read_checkouts,unauthenticated_read_metaobjects,unauthenticated_read_product_listings"
    )}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  return response;
}
