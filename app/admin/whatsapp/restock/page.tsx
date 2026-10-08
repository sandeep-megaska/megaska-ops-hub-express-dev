import Link from "next/link";
import { prisma } from "../../../../services/db/prisma";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../../services/shopify/admin-shop-context";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; badge: string }> = {
  WAITING: { label: "Waiting", badge: "warning" },
  NOTIFIED: { label: "Told it's back", badge: "success" },
  CANCELLED: { label: "Opted out", badge: "neutral" },
  EXPIRED: { label: "Expired", badge: "neutral" },
};

// Requests still waiting, plus those that ended in the last 60 days.
function recentCutoff() {
  return new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
}

function formatWhen(value: Date | null) {
  return value ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";
}

export default async function BackInStockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const resolved = await resolveAdminShopFromSearchParams(params);
  const shop = resolved.shop;
  if (!shop?.id) {
    return <div className="mk-page"><section className="mk-card"><p className="mk-section-subtitle">{formatAdminShopResolutionError(resolved)}</p></section></div>;
  }
  const since = recentCutoff();
  const [account, requests] = await Promise.all([
    prisma.merchantWhatsAppAccount.findUnique({ where: { shopId: shop.id }, select: { enabled: true, backInStockEnabled: true, aiMode: true } }).catch(() => null),
    prisma.backInStockRequest.findMany({ where: { shopId: shop.id, OR: [{ status: "WAITING" }, { updatedAt: { gte: since } }] }, orderBy: { createdAt: "desc" }, take: 500 }).catch(() => []),
  ]);

  // Demand by item: what customers are waiting for (useful for restocking and production).
  const demand = new Map<string, { item: string; productId: string; waiting: number; oldest: Date }>();
  for (const request of requests) {
    if (request.status !== "WAITING") continue;
    const item = request.variantTitle ? `${request.productTitle} (${request.variantTitle})` : request.productTitle;
    const entry = demand.get(item) ?? { item, productId: request.productId, waiting: 0, oldest: request.createdAt };
    entry.waiting += 1;
    if (request.createdAt < entry.oldest) entry.oldest = request.createdAt;
    demand.set(item, entry);
  }
  const demandRows = [...demand.values()].sort((a, b) => b.waiting - a.waiting);
  const count = (status: string) => requests.filter((request) => request.status === status).length;
  const storeHandle = shop.shopDomain.replace(/\.myshopify\.com$/, "");
  const shopParam = `shop=${encodeURIComponent(shop.shopDomain)}`;
  const numericId = (gid: string) => gid.match(/(\d+)$/)?.[1] ?? gid;

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Back in stock</h1>
          <p className="mk-page-subtitle">
            Customers who asked on WhatsApp to be told when a sold-out product, size or colour is back. Each gets one WhatsApp as soon as Shopify shows it in stock again (9 am–9 pm IST). The list at the top shows what people are waiting for, so you know what to restock first.
          </p>
        </div>
        <div className="mk-header-actions">
          <Link className="mk-btn" href={`/admin/whatsapp?${shopParam}`}>WhatsApp inbox</Link>
          <Link className="mk-btn" href={`/admin/merchant-settings?${shopParam}#whatsapp`}>Settings</Link>
        </div>
      </div>

      {!account?.enabled || !account.backInStockEnabled ? (
        <div className="mk-alert mk-alert-warning" style={{ marginBottom: 16 }}>
          Back-in-stock alerts are off. Switch them on in <Link href={`/admin/merchant-settings?${shopParam}#whatsapp`}>Merchant Settings → WhatsApp</Link> once the back_in_stock template is approved. The AI assistant must be answering (or suggesting) for customers to be offered the alert.
        </div>
      ) : null}

      <div className="mk-kpi-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Waiting", String(count("WAITING"))],
          ["Items asked for", String(demandRows.length)],
          ["Told it's back (60 days)", String(count("NOTIFIED"))],
          ["Expired / opted out", String(count("EXPIRED") + count("CANCELLED"))],
        ].map(([label, value]) => (
          <div key={label} className="mk-stat-card"><div className="mk-stat-label">{label}</div><div className="mk-stat-value">{value}</div></div>
        ))}
      </div>

      <section className="mk-card" style={{ marginBottom: 16 }}>
        <h2 className="mk-section-title">What customers are waiting for</h2>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead><tr><th>Item</th><th>Customers waiting</th><th>Waiting since</th></tr></thead>
            <tbody>
              {demandRows.length === 0 ? <tr><td colSpan={3}>Nobody is waiting right now.</td></tr> : demandRows.map((row) => (
                <tr key={row.item}>
                  <td><a href={`https://admin.shopify.com/store/${storeHandle}/products/${numericId(row.productId)}`} target="_blank" rel="noopener noreferrer">{row.item}</a></td>
                  <td>{row.waiting}</td>
                  <td>{formatWhen(row.oldest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mk-card">
        <h2 className="mk-section-title">Requests</h2>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead><tr><th>Customer</th><th>Item</th><th>Asked</th><th>Status</th><th>Told</th></tr></thead>
            <tbody>
              {requests.length === 0 ? <tr><td colSpan={5}>No back-in-stock requests yet.</td></tr> : requests.map((request) => {
                const status = STATUS[request.status] ?? STATUS.WAITING;
                return (
                  <tr key={request.id}>
                    <td>{request.customerName || "—"}<br /><span className="mk-help">+{request.phone}</span></td>
                    <td>{request.variantTitle ? `${request.productTitle} (${request.variantTitle})` : request.productTitle}</td>
                    <td>{formatWhen(request.createdAt)}</td>
                    <td><span className={`mk-badge mk-badge-${status.badge}`}>{status.label}</span></td>
                    <td>{formatWhen(request.notifiedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
