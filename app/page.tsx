import Link from "next/link";

const quickCards = [
  {
    title: "GST Operations",
    value: "Sync + dispatch",
    meta: "Manage invoices, sync flow and GST workflows",
    href: "/admin/gst",
  },
  {
    title: "Exchanges",
    value: "Workflow Queue",
    meta: "Track exchange requests and pending actions",
    href: "/admin/exchanges",
  },
  {
    title: "Cancellations",
    value: "Request Control",
    meta: "Review cancellation flow and current statuses",
    href: "/admin/cancellations",
  },
  {
    title: "Issues",
    value: "Support Cases",
    meta: "Customer-reported issues and resolution status",
    href: "/admin/issues",
  },
];

export default function DashboardPage() {
  return (
    <div className="mk-page">
      <section className="mk-hero">
        <h1 className="mk-hero-title">Megaska Ops Hub</h1>
        <p className="mk-hero-subtitle">
          Central control for store operations. Monitor workflows, manage
          exceptions, and navigate quickly across GST, exchanges,
          cancellations, and issues.
        </p>

        <div className="mk-hero-actions">
          <Link href="/admin/gst" className="mk-btn mk-btn-primary">
            Open GST
          </Link>
          <Link href="/admin/exchanges" className="mk-btn">
            Open Exchanges
          </Link>
        </div>
      </section>

      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Active Modules</p>
          <p className="mk-stat-value">4</p>
          <p className="mk-stat-meta">GST, Exchanges, Cancellations, Issues</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Store Mode</p>
          <p className="mk-stat-value">Multi-store</p>
          <p className="mk-stat-meta">Shop-aware backend architecture enabled</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Admin Surface</p>
          <p className="mk-stat-value">Embedded</p>
          <p className="mk-stat-meta">Running inside Shopify admin</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">System Status</p>
          <p className="mk-stat-value">Healthy</p>
          <p className="mk-stat-meta">Core ops hub accessible and ready</p>
        </div>
      </section>

      <section className="mk-card">
        <h2 className="mk-section-title">Operations Dashboard</h2>
        <p className="mk-section-subtitle">
          Quick access to all operational workflows.
        </p>

        <div className="mk-grid-2">
          {quickCards.map((card) => (
            <Link key={card.href} href={card.href} className="mk-card">
              <p className="mk-stat-label">{card.title}</p>
              <p className="mk-stat-value" style={{ fontSize: 24 }}>
                {card.value}
              </p>
              <p className="mk-stat-meta">{card.meta}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
