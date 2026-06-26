import "./globals.css";
import Link from "next/link";

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

            <nav className="mk-nav">
              <Link href="/" className="mk-nav-link">
                Dashboard
              </Link>
              <Link href="/admin/gst" className="mk-nav-link">
                GST
              </Link>
              <Link href="/admin/exchanges" className="mk-nav-link">
                Exchanges
              </Link>
              <Link href="/admin/cancellations" className="mk-nav-link">
                Cancellations
              </Link>
              <Link href="/admin/issues" className="mk-nav-link">
                Issues
              </Link>
              <Link href="/admin/cod-advance" className="mk-nav-link">
                COD Advance
              </Link>
            </nav>

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
