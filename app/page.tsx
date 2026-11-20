import { Suspense } from "react";
import AdminNavLink from "./AdminNavLink";
import CustomerSyncCard from "./CustomerSyncCard";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams, type AdminShopSearchParams } from "../services/shopify/admin-shop-context";
import { getSetupProgress } from "../services/setup/setup-progress";

export const dynamic = "force-dynamic";

type ModuleCard = { title: string; meta: string; href: string };
type ModuleGroup = { heading: string; blurb: string; cards: ModuleCard[] };

const moduleGroups: ModuleGroup[] = [
  {
    heading: "Storefront & conversion",
    blurb: "Everything the shopper sees — promotions, reviews, and the drawer.",
    cards: [
      { title: "Prepaid offer & COD", meta: "Prepaid discount, COD charge, and phone verification before checkout", href: "/admin/checkout" },
      { title: "Checkout Analytics", meta: "Checkout funnel, drop-off, abandoned carts, and recovery", href: "/admin/analytics" },
      { title: "Promotions", meta: "Cart offers, tiered order discounts, and compilation status", href: "/admin/promotions" },
      { title: "Reviews", meta: "Moderate, import/export, and configure review display", href: "/admin/reviews" },
      { title: "Merchant Settings", meta: "Branding, cart drawer, labels, and runtime settings", href: "/admin/merchant-settings" },
      { title: "Installation Wizard", meta: "Theme embed and provider readiness", href: "/admin/installation-wizard" },
    ],
  },
  {
    heading: "Orders & fulfilment",
    blurb: "Post-purchase operations across the order lifecycle.",
    cards: [
      { title: "Shipments", meta: "Bulk-book Delhivery shipments for unfulfilled orders", href: "/admin/shipments" },
      { title: "Free parcels", meta: "Influencer, PR and vendor-sample parcels: stock, tracking and cost records", href: "/admin/collabs" },
      { title: "Exchanges", meta: "Track exchange requests and pending actions", href: "/admin/exchanges" },
      { title: "Cancellations", meta: "Review cancellation requests and statuses", href: "/admin/cancellations" },
      { title: "Refunds", meta: "Process and audit refund requests", href: "/admin/refunds" },
      { title: "Issues", meta: "Customer-reported issues and resolution status", href: "/admin/issues" },
    ],
  },
  {
    heading: "Payments & finance",
    blurb: "Store credit and billing.",
    cards: [
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

// Shopify opens the app here right after install. Resolving the shop on this first
// verified load is what installs it (token exchange) before any other page is used.
export default async function DashboardPage({ searchParams }: { searchParams?: Promise<AdminShopSearchParams> }) {
  const resolved = await resolveAdminShopFromSearchParams((await searchParams) ?? {});
  if (!resolved.shop?.id) {
    return (
      <div className="mk-page">
        <div className="mk-alert mk-alert-error" role="alert">{formatAdminShopResolutionError(resolved)}</div>
      </div>
    );
  }

  const setup = await getSetupProgress(resolved.shop.id);
  const setupDone = setup.completed === setup.total;
  const themeEmbedHref = `https://${resolved.shop.shopDomain}/admin/themes/current/editor?context=apps`;

  return (
    <div className="mk-page">
      <section className="mk-hero mk-hero-compact" aria-labelledby="home-title">
        <div className="mk-hero-row">
          <div>
            <p className="mk-hero-tagline">LoopD2C · Shopify Commerce Experience Platform</p>
            <h1 id="home-title" className="mk-hero-title">Welcome to LoopD2C</h1>
            <p className="mk-hero-subtitle">Your store&apos;s bag, checkout, post-purchase and GST tools in one place.</p>
          </div>
          <Suspense fallback={null}>
            <div className="mk-setup" aria-label="Setup progress">
              <div className="mk-setup-head">
                <span>{setupDone ? "Setup complete" : `Setup: ${setup.completed} of ${setup.total} done`}</span>
                <span className="mk-setup-bar" aria-hidden="true"><span style={{ width: `${Math.round((setup.completed / setup.total) * 100)}%` }} /></span>
              </div>
              {setupDone ? (
                <div className="mk-hero-actions">
                  <AdminNavLink href="/admin/promotions" className="mk-btn mk-btn-primary">Promotions</AdminNavLink>
                  <AdminNavLink href="/admin/checkout" className="mk-btn">Prepaid offer &amp; COD</AdminNavLink>
                  <AdminNavLink href="/admin/merchant-settings" className="mk-btn">Merchant Settings</AdminNavLink>
                </div>
              ) : (
                <>
                  <ul className="mk-setup-steps">
                    {setup.steps.map((step) => (
                      <li key={step.id}>
                        <AdminNavLink href={step.href} className={`mk-setup-step${step.done ? " is-done" : ""}`}>
                          <span aria-hidden="true">{step.done ? "✓" : "○"}</span> {step.label}
                          <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                        </AdminNavLink>
                      </li>
                    ))}
                  </ul>
                  <div className="mk-hero-actions">
                    {setup.next ? <AdminNavLink href={setup.next.href} className="mk-btn mk-btn-primary">Next: {setup.next.label}</AdminNavLink> : null}
                    <a href={themeEmbedHref} target="_top" className="mk-btn">Theme app embed ↗</a>
                  </div>
                </>
              )}
            </div>
          </Suspense>
        </div>
      </section>

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

      <CustomerSyncCard />
    </div>
  );
}
