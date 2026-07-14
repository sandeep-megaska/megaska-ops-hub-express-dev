import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appProxyHtmlError, requireEnabledModule, requireStorefrontShopFromAppProxy } from "../../../../services/shopify/app-proxy";

const MODULE_KEY = "dashboard";
const ASSET_BASE = "/apps/megaska/account/assets";

function escapeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export async function GET(request: NextRequest) {
  try {
    const shop = await requireStorefrontShopFromAppProxy(request);
    await requireEnabledModule(shop.id, MODULE_KEY);
    const config = {
      apiUrl: "/apps/megaska/api/dashboard/summary",
      dashboardUrl: "/apps/megaska/account",
      homeUrl: "/",
      supportUrl: "/pages/contact",
      continueShoppingUrl: "/collections/all",
      shopDomain: shop.shopDomain,
      accountLabel: "My Account",
      brandLabel: "Megaska Account",
    };
    const html = `<!doctype html>
<html lang="en" data-shop-domain="${shop.shopDomain}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Megaska Account</title>
  <link rel="stylesheet" href="${ASSET_BASE}/megaska-otp.css">
  <link rel="stylesheet" href="${ASSET_BASE}/loopdesk-customer-dashboard.css">
</head>
<body>
  <main>
    <div id="loopdesk-customer-dashboard-root" data-loopdesk-customer-dashboard></div>
  </main>
  <script type="application/json" id="loopdesk-customer-dashboard-config">${escapeJson(config)}</script>
  <script>window.MEGASKA_SHOP_DOMAIN=${escapeJson(shop.shopDomain)};</script>
  <script src="${ASSET_BASE}/megaska-auth.js" defer></script>
  <script src="${ASSET_BASE}/megaska-otp.js" defer></script>
  <script src="${ASSET_BASE}/loopdesk-customer-dashboard.js" defer></script>
</body>
</html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return appProxyHtmlError(error);
  }
}

export const dynamic = "force-dynamic";
