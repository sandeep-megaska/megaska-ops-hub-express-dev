import { headers } from "next/headers";
import {
  formatAdminShopResolutionError,
  resolveAdminShopFromSearchParams,
} from "../../../services/shopify/admin-shop-context";
import { normalizeShopDomain } from "../../../services/shopify/shop";
import CheckoutAnalyticsClient from "./CheckoutAnalyticsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CheckoutAnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{ shop?: string; shopify_shop?: string; host?: string; hmac?: string }>;
}) {
  const params = (await searchParams) ?? {};
  // Prefer the embedded-admin query params (AdminNavLink preserves shop/host on
  // navigation); fall back to the x-shopify-shop-domain header. Resolve + verify
  // install server-side so the client fetches with a real shop domain.
  const merged: Record<string, string | string[] | undefined> = { ...params };
  if (!merged.shop && !merged.shopify_shop) {
    const headerShop = normalizeShopDomain((await headers()).get("x-shopify-shop-domain"));
    if (headerShop) merged.shop = headerShop;
  }

  const resolved = await resolveAdminShopFromSearchParams(merged);
  if (!resolved.shop?.id) {
    return (
      <main className="mk-main">
        <div className="mk-page">
          <header className="mk-page-header">
            <div><h1 className="mk-page-title">Checkout analytics</h1></div>
          </header>
          <div className="mk-alert mk-alert-error" role="alert">{formatAdminShopResolutionError(resolved)}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="mk-main">
      <CheckoutAnalyticsClient shop={resolved.shopDomain} />
    </main>
  );
}
