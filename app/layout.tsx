import "./globals.css";
import { Suspense } from "react";
import AdminNavLink from "./AdminNavLink";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
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
              <nav className="mk-nav">
                <AdminNavLink href="/" className="mk-nav-link">
                  Dashboard
                </AdminNavLink>
                <AdminNavLink href="/admin/gst" className="mk-nav-link">
                  GST
                </AdminNavLink>
                <AdminNavLink href="/admin/exchanges" className="mk-nav-link">
                  Exchanges
                </AdminNavLink>
                <AdminNavLink href="/admin/cancellations" className="mk-nav-link">
                  Cancellations
                </AdminNavLink>
                <AdminNavLink href="/admin/wallets" className="mk-nav-link">
                  Store Credit / Wallets
                </AdminNavLink>
                <AdminNavLink href="/admin/issues" className="mk-nav-link">
                  Issues
                </AdminNavLink>
                <AdminNavLink href="/admin/installation-wizard" className="mk-nav-link">
                  Installation Wizard
                </AdminNavLink>
                <AdminNavLink href="/admin/merchant-settings" className="mk-nav-link">
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

          <main className="mk-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
