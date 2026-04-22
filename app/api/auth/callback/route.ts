import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "../../../../services/db/prisma";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL!;

function isValidShop(shop: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

function validateHmac(params: URLSearchParams, secret: string) {
  const hmac = params.get("hmac") || "";
  const entries = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b));

  const message = entries.map(([key, value]) => `${key}=${value}`).join("&");

  const generated = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  if (generated.length !== hmac.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(generated, "utf8"),
    Buffer.from(hmac, "utf8")
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const shop = String(params.get("shop") || "").trim();
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
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return NextResponse.json(
      { error: "Token exchange failed", details: text },
      { status: 500 }
    );
  }

  const tokenData = await tokenRes.json();
  const accessToken = String(tokenData.access_token || "");

  if (!accessToken) {
    return NextResponse.json({ error: "No access token returned" }, { status: 500 });
  }

  await prisma.shop.upsert({
    where: { shopDomain: shop },
    update: {
      accessToken,
      isActive: true,
      installedAt: new Date(),
      uninstalledAt: null,
    },
    create: {
      shopDomain: shop,
      accessToken,
      isActive: true,
      installedAt: new Date(),
    },
  });

  return NextResponse.redirect(
  `${SHOPIFY_APP_URL}/?shop=${encodeURIComponent(shop)}`
);
}
