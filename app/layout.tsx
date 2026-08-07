import "./globals.css";
import { Suspense } from "react";
import AdminNavLink from "./AdminNavLink";
import ShopifyHostContext from "./ShopifyHostContext";
import { AdminEmbeddedProvider } from "./AdminEmbeddedProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY || ""} />
        {/*
          Persist shop + host from the initial Admin URL SYNCHRONOUSLY, before
          App Bridge boots. App Bridge strips shop/host from the iframe URL once
          it initializes, so a data fetch that reads window.location.search a beat
          later finds no shop and the server (which resolves the shop only from
          the request URL / referer) answers 404 — the page then renders blank
          until a manual refresh reloads Shopify's original URL. Capturing here,
          ahead of the app-bridge script tag, guarantees the shop is saved while
          it is still on the URL; client fetches fall back to this stored value.
        */}
        <script
          id="shopify-context-capture"
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var params = new URLSearchParams(window.location.search);
                  var shop = (params.get("shop") || params.get("shopify_shop") || "").trim().toLowerCase();
                  if (!shop) return;
                  window.sessionStorage.setItem("megaska:shopify-shop", shop);
                  window.localStorage.setItem("megaska:shopify-shop", shop);
                  var host = (params.get("host") || "").trim();
                  if (host) {
                    var key = "megaska:shopify-host:" + shop;
                    window.sessionStorage.setItem(key, host);
                    window.localStorage.setItem(key, host);
                  }
                } catch (e) {
                  /* storage can be blocked in some embedded contexts; URL fallback still applies */
                }
              })();
            `,
          }}
        />
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- Shopify App Bridge CDN must be server-rendered in the initial admin document head. */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
      </head>
      <body>
        <Suspense fallback={<div className="mk-shell" />}>
          <AdminEmbeddedProvider apiKey={process.env.SHOPIFY_API_KEY || ""}>
            <div className="mk-shell">
              <aside className="mk-sidebar">
                <div className="mk-brand">
                  <div className="mk-brand-badge">L</div>
                  <div>
                    <p className="mk-brand-title">LoopD2C</p>
                    <p className="mk-brand-subtitle">Built from real D2C operations</p>
                    <p className="mk-brand-tagline">Shopify Commerce Experience Platform</p>
                  </div>
                </div>

                <Suspense fallback={null}>
                  <ShopifyHostContext />
                  <nav className="mk-nav">
                    <AdminNavLink href="/" className="mk-nav-link">
                      Dashboard
                    </AdminNavLink>
                    <AdminNavLink href="/admin/gst" className="mk-nav-link">
                      GST
                    </AdminNavLink>
                    <AdminNavLink href="/admin/promotions" className="mk-nav-link">
                      Promotions
                    </AdminNavLink>
                    <AdminNavLink href="/admin/billing" className="mk-nav-link">
                      Billing
                    </AdminNavLink>
                    <AdminNavLink href="/admin/partial-cod" className="mk-nav-link">
                      Partial COD
                    </AdminNavLink>
                    <AdminNavLink
                      href="/admin/exchanges"
                      className="mk-nav-link"
                    >
                      Exchanges
                    </AdminNavLink>
                    <AdminNavLink
                      href="/admin/cancellations"
                      className="mk-nav-link"
                    >
                      Cancellations
                    </AdminNavLink>
                    <AdminNavLink href="/admin/wallets" className="mk-nav-link">
                      Store Credit / Wallets
                    </AdminNavLink>
                    <AdminNavLink href="/admin/reviews" className="mk-nav-link">
                      Reviews
                    </AdminNavLink>
                    <AdminNavLink href="/admin/issues" className="mk-nav-link">
                      Issues
                    </AdminNavLink>
                    <AdminNavLink
                      href="/admin/installation-wizard"
                      className="mk-nav-link"
                    >
                      Installation Wizard
                    </AdminNavLink>
                    <AdminNavLink
                      href="/admin/merchant-settings"
                      className="mk-nav-link"
                    >
                      Merchant Settings
                    </AdminNavLink>
                  </nav>
                </Suspense>

                <div className="mk-sidebar-footer">
                  <div className="mk-mini-card">
                    <p className="mk-mini-label">System</p>
                    <p className="mk-mini-value">Multi-store Ready</p>
                  </div>
                </div>
              </aside>

              <main className="mk-main">
                {children}
              </main>
            </div>
          </AdminEmbeddedProvider>
        </Suspense>
      </body>
    </html>
  );
}
