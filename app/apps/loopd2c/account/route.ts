import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appProxyHtmlError, requireEnabledModule, requireStorefrontShopFromAppProxy } from "../../../../services/shopify/app-proxy";

const MODULE_KEY = "dashboard";
const ASSET_BASE = "/apps/loopd2c/account/assets";

// The assets are served immutable + long-lived (see the [asset] route), but at a
// FIXED url — so a mutable, per-deploy file like loopdesk-customer-dashboard.js
// would be cached forever and never pick up a new deploy. Version the query per
// build so each deploy is a fresh, uncacheable-against URL. The account HTML
// itself is `no-store`, so the new url takes effect on the very next page load.
const ASSET_VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev").slice(0, 12);
const asset = (name: string) => `${ASSET_BASE}/${name}?v=${ASSET_VERSION}`;

function escapeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export async function GET(request: NextRequest) {
  try {
    const shop = await requireStorefrontShopFromAppProxy(request);
    await requireEnabledModule(shop.id, MODULE_KEY);
    const config = {
      apiUrl: "/apps/loopd2c/api/dashboard/summary",
      dashboardUrl: "/apps/loopd2c/account",
      homeUrl: "/",
      supportUrl: "/pages/contact",
      continueShoppingUrl: "/collections/all",
      logoutRedirectUrl: "/",
      shopDomain: shop.shopDomain,
      accountLabel: "My Account",
      brandLabel: "Account",
    };
    const html = `<!doctype html>
<html lang="en" data-shop-domain="${shop.shopDomain}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Account</title>
  <link rel="stylesheet" href="${asset("megaska-otp.css")}">
  <link rel="stylesheet" href="${asset("loopdesk-customer-dashboard.css")}">
</head>
<body>
  <!-- Standalone App Proxy page: intentionally theme-independent. Use the normal Shopify theme page plus the LoopDesk customer dashboard app block when merchant theme header/footer is required. -->
  <main>
    <div id="loopdesk-customer-dashboard-root" data-loopdesk-customer-dashboard></div>
  </main>
  <script type="application/json" id="loopdesk-customer-dashboard-config">${escapeJson(config)}</script>
  <script>window.MEGASKA_SHOP_DOMAIN=${escapeJson(shop.shopDomain)};</script>
  <script src="${asset("megaska-auth.js")}" defer></script>
  <script src="${asset("megaska-otp.js")}" defer></script>
  <script src="${asset("loopdesk-customer-dashboard.js")}" defer></script>
</body>
</html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return appProxyHtmlError(error);
  }
}

export const dynamic = "force-dynamic";
