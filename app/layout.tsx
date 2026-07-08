import "./globals.css";
import { Suspense } from "react";
import AdminNavLink from "./AdminNavLink";
import ShopifyHostContext from "./ShopifyHostContext";
import { AdminEmbeddedProvider } from "./AdminEmbeddedProvider";
import AdminEmbeddedDiagnostic from "./AdminEmbeddedDiagnostic";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {process.env.SHOPIFY_API_KEY ? <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY} /> : null}
        {process.env.SHOPIFY_API_KEY ? (
          <script
            id="shopify-app-bridge-diagnostics-before"
            dangerouslySetInnerHTML={{
              __html: `
                window.__shopifyAppBridgeScriptLoaded = false;
                window.__shopifyAppBridgeScriptError = "";
                window.__shopifyAppBridgeScriptEvents = [];
                window.__markShopifyAppBridgeLoaded = function () {
                  window.__shopifyAppBridgeScriptLoaded = true;
                  window.__shopifyAppBridgeScriptEvents.push({ type: "load", at: Date.now(), shopifyPresent: Boolean(window.shopify), resourcePickerType: typeof window.shopify?.resourcePicker });
                };
                window.__markShopifyAppBridgeError = function (event) {
                  var target = event && event.target;
                  window.__shopifyAppBridgeScriptError = "App Bridge CDN script failed to load or was blocked: " + (target && target.src ? target.src : "unknown source");
                  window.__shopifyAppBridgeScriptEvents.push({ type: "error", at: Date.now(), message: window.__shopifyAppBridgeScriptError });
                };
              `,
            }}
          />
        ) : null}
        {process.env.SHOPIFY_API_KEY ? (
          <script
            id="shopify-app-bridge-cdn-writer"
            dangerouslySetInnerHTML={{
              __html: `
                document.write('<script id="shopify-app-bridge-cdn" src="https://cdn.shopify.com/shopifycloud/app-bridge.js" onload="window.__markShopifyAppBridgeLoaded && window.__markShopifyAppBridgeLoaded()" onerror="window.__markShopifyAppBridgeError && window.__markShopifyAppBridgeError(event)"><\/script>');
              `,
            }}
          />
        ) : null}
        {process.env.SHOPIFY_API_KEY ? (
          <script
            id="shopify-app-bridge-diagnostics-after"
            dangerouslySetInnerHTML={{
              __html: `
                window.__shopifyAppBridgeScriptEvents.push({ type: "after-tag", at: Date.now(), shopifyPresent: Boolean(window.shopify), resourcePickerType: typeof window.shopify?.resourcePicker });
              `,
            }}
          />
        ) : null}
      </head>
      <body>
        <Suspense fallback={<div className="mk-shell" />}>
          <AdminEmbeddedProvider apiKey={process.env.SHOPIFY_API_KEY || ""}>
            <div className="mk-shell">
              <aside className="mk-sidebar">
                <div className="mk-brand">
                  <div className="mk-brand-badge">M</div>
                  <div>
                    <p className="mk-brand-title">Megaska Ops Hub</p>
                    <p className="mk-brand-subtitle">Admin Panel</p>
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
                    <AdminNavLink
                      href="/admin/promotion-rules"
                      className="mk-nav-link"
                    >
                      Promotion Rules
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
                <Suspense fallback={null}>
                  <AdminEmbeddedDiagnostic />
                </Suspense>
                {children}
              </main>
            </div>
          </AdminEmbeddedProvider>
        </Suspense>
      </body>
    </html>
  );
}
