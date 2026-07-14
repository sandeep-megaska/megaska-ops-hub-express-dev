import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appProxyHtmlError, requireEnabledModule, requireStorefrontShopFromAppProxy } from "../../../../services/shopify/app-proxy";
import { getCustomerDashboardSettingsForShop } from "../../../../services/customer-dashboard/settings";

const MODULE_KEY = "dashboard";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] || char);
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function logSafe(event: string, details: Record<string, unknown>) {
  console.info(event, details);
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const shop = await requireStorefrontShopFromAppProxy(request);
    await requireEnabledModule(shop.id, MODULE_KEY);
    const settings = await getCustomerDashboardSettingsForShop(shop.id);
    const config = {
      apiUrl: "/apps/megaska/api/customer-dashboard/v1",
      loginUrl: "/account/login",
      shopDomain: shop.shopDomain,
      dashboardUrl: settings.links.dashboardUrl,
      logoutRedirectUrl: settings.links.logoutRedirectUrl,
      branding: settings.branding,
      sections: settings.sections,
      orders: settings.orders,
      copy: settings.copy,
      accountLabel: settings.branding.accountLabel,
      supportUrl: settings.links.supportUrl,
      continueShoppingUrl: settings.links.continueShoppingUrl,
      logoUrl: settings.branding.logoUrl,
      enabled: settings.enabled,
    };
    if (!settings.enabled) {
      const title = escapeHtml(settings.branding.heading);
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/apps/megaska/account/assets/loopdesk-customer-dashboard.css"></head><body><main class="ld-account-shell"><section class="ld-account-unavailable"><h1>${title}</h1><p>Customer dashboard is currently unavailable.</p><a class="ld-account-button ld-account-button-primary" href="${escapeHtml(settings.links.continueShoppingUrl || "/")}">${escapeHtml(settings.copy.continueShoppingLabel)}</a></section></main></body></html>`;
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    logSafe("customer_dashboard_shell_rendered", { shopId: shop.id, shopDomain: shop.shopDomain, durationMs: Date.now() - startedAt });
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(settings.branding.heading)}</title><link rel="stylesheet" href="/apps/megaska/account/assets/loopdesk-customer-dashboard.css"></head><body><div id="loopdesk-customer-dashboard-root" data-loopdesk-customer-dashboard><noscript>JavaScript is required to view your account.</noscript></div><script>window.MEGASKA_SHOP_DOMAIN=${safeJson(shop.shopDomain)};window.LoopDeskCustomerDashboardConfig=${safeJson(config)};</script><script src="/apps/megaska/account/assets/megaska-auth.js" defer></script><script src="/apps/megaska/account/assets/loopdesk-customer-dashboard.js" defer></script></body></html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    logSafe("customer_dashboard_shell_error", { shopId: null, shopDomain: null, durationMs: Date.now() - startedAt, errorCode: error instanceof Error ? error.name : "UNKNOWN" });
    return appProxyHtmlError(error);
  }
}

export const dynamic = "force-dynamic";
