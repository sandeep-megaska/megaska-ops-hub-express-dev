import { Suspense } from "react";
import AdminNavLink from "./AdminNavLink";
import CustomerSyncCard from "./CustomerSyncCard";

type ModuleCard = { title: string; meta: string; href: string };
type ModuleGroup = { heading: string; blurb: string; cards: ModuleCard[] };

const moduleGroups: ModuleGroup[] = [
  {
    heading: "Storefront & conversion",
    blurb: "Everything the shopper sees — promotions, reviews, and the drawer.",
    cards: [
      { title: "Checkout Analytics", meta: "Express-checkout funnel, drop-off, abandoned carts, and recovery", href: "/admin/analytics" },
      { title: "Promotions", meta: "Cart offers, tiered order discounts, and compilation status", href: "/admin/promotions" },
      { title: "Reviews", meta: "Moderate, import/export, and configure review display", href: "/admin/reviews" },
      { title: "Merchant Settings", meta: "Branding, cart drawer, labels, and runtime settings", href: "/admin/merchant-settings" },
      { title: "Installation Wizard", meta: "OAuth, theme embed, and provider readiness", href: "/admin/installation-wizard" },
    ],
  },
  {
    heading: "Orders & fulfilment",
    blurb: "Post-purchase operations across the order lifecycle.",
    cards: [
      { title: "Exchanges", meta: "Track exchange requests and pending actions", href: "/admin/exchanges" },
      { title: "Cancellations", meta: "Review cancellation requests and statuses", href: "/admin/cancellations" },
      { title: "Refunds", meta: "Process and audit refund requests", href: "/admin/refunds" },
      { title: "Issues", meta: "Customer-reported issues and resolution status", href: "/admin/issues" },
    ],
  },
  {
    heading: "Payments & finance",
    blurb: "Money movement — advances, store credit, and billing.",
    cards: [
      { title: "COD Advance", meta: "Partial advance collection on cash-on-delivery orders", href: "/admin/cod-advance" },
      { title: "Partial COD", meta: "Configure partial cash-on-delivery policies", href: "/admin/partial-cod" },
      { title: "Wallets", meta: "Store credit balances and ledger operations", href: "/admin/wallets" },
      { title: "Billing", meta: "Subscription and usage billing", href: "/admin/billing" },
    ],
  },
  {
    heading: "Tax & compliance",
    blurb: "GST invoicing, numbering, and dispatch workflows.",
    cards: [
      { title: "GST Operations", meta: "Invoices, sync flow, and dispatch-ready orders", href: "/admin/gst" },
      { title: "GST Settings", meta: "Document numbering and per-shop GST configuration", href: "/admin/gst/settings" },
      { title: "GST Products", meta: "HSN codes and SKU tax mapping", href: "/admin/gst/products" },
    ],
  },
];

export default function DashboardPage() {
  return (
    <div className="mk-page">
      <section className="mk-hero">
        <p className="mk-hero-tagline">LoopD2C · Commerce Operations Platform</p>
        <h1 className="mk-hero-title">Operations Hub</h1>
        <p className="mk-hero-subtitle">
          Your control center for storefront conversion, order operations, payments, and
          GST compliance — all shop-aware and built for D2C on Shopify.
        </p>
        <Suspense fallback={null}>
          <div className="mk-hero-actions">
            <AdminNavLink href="/admin/promotions" className="mk-btn mk-btn-primary">
              Manage Promotions
            </AdminNavLink>
            <AdminNavLink href="/admin/merchant-settings" className="mk-btn">
              Merchant Settings
            </AdminNavLink>
          </div>
        </Suspense>
      </section>

      <CustomerSyncCard />

      <Suspense fallback={null}>
        {moduleGroups.map((group) => (
          <section key={group.heading} className="mk-card">
            <h2 className="mk-section-title">{group.heading}</h2>
            <p className="mk-section-subtitle">{group.blurb}</p>
            <div className="mk-grid-3">
              {group.cards.map((card) => (
                <AdminNavLink
                  key={card.href}
                  href={card.href}
                  className="mk-card mk-card-hover"
                >
                  <p className="mk-list-title">{card.title}</p>
                  <p className="mk-stat-meta">{card.meta}</p>
                </AdminNavLink>
              ))}
            </div>
          </section>
        ))}
      </Suspense>
    </div>
  );
}
