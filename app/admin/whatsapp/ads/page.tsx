import Link from "next/link";
import { prisma } from "../../../../services/db/prisma";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../../services/shopify/admin-shop-context";
import { AD_ATTRIBUTION_DAYS, AD_ORDER_EVENT } from "../../../../services/whatsapp/ad-attribution";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

function windowStart() {
  return new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function rupees(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export default async function WhatsAppAdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const resolved = await resolveAdminShopFromSearchParams(params);
  const shop = resolved.shop;
  if (!shop?.id) {
    return <div className="mk-page"><section className="mk-card"><p className="mk-section-subtitle">{formatAdminShopResolutionError(resolved)}</p></section></div>;
  }
  const since = windowStart();
  const [account, chats, orders] = await Promise.all([
    prisma.merchantWhatsAppAccount.findUnique({ where: { shopId: shop.id }, select: { adConversionsEnabled: true } }).catch(() => null),
    prisma.whatsAppConversation.findMany({ where: { shopId: shop.id, adReferredAt: { gte: since } }, select: { id: true, adSourceId: true, adHeadline: true, adReferredAt: true } }).catch(() => []),
    prisma.auditEvent.findMany({ where: { eventType: AD_ORDER_EVENT, createdAt: { gte: since }, payload: { path: ["shopId"], equals: shop.id } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, payload: true } }).catch(() => []),
  ]);

  type Row = { key: string; headline: string; chats: number; orders: number; revenue: number };
  const rows = new Map<string, Row>();
  const rowFor = (adSourceId: string | null, headline: string | null) => {
    const key = adSourceId || "unknown";
    const row = rows.get(key) ?? { key, headline: headline || (adSourceId ? `Ad ${adSourceId}` : "Ad (no id)"), chats: 0, orders: 0, revenue: 0 };
    if (headline && row.headline.startsWith("Ad ")) row.headline = headline;
    rows.set(key, row);
    return row;
  };
  for (const chat of chats) rowFor(chat.adSourceId, chat.adHeadline).chats += 1;
  const orderList = orders.map((event) => {
    const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>;
    const total = Number(payload.total) || 0;
    const row = rowFor((payload.adSourceId as string | null) ?? null, (payload.adHeadline as string | null) ?? null);
    row.orders += 1;
    row.revenue += total;
    return { at: event.createdAt, orderName: String(payload.orderName || ""), total, headline: String(payload.adHeadline || payload.adSourceId || "—"), capi: String(payload.capi || "off") };
  });
  const list = [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.chats - a.chats);
  const totalRevenue = orderList.reduce((sum, order) => sum + order.total, 0);
  const shopParam = `shop=${encodeURIComponent(shop.shopDomain)}`;
  const capiLabel: Record<string, string> = { sent: "Sent to Meta", failed: "Meta rejected", no_click_id: "No click id", off: "Not reported" };

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">WhatsApp ads</h1>
          <p className="mk-page-subtitle">
            Click-to-WhatsApp ads in the last {WINDOW_DAYS} days: how many chats each ad started and the orders those customers placed within {AD_ATTRIBUTION_DAYS} days of tapping it (matched by phone number). Use this next to Ads Manager, which only sees chats unless sales are reported back.
          </p>
        </div>
        <div className="mk-header-actions">
          <Link className="mk-btn" href={`/admin/whatsapp?${shopParam}`}>WhatsApp inbox</Link>
          <Link className="mk-btn" href={`/admin/merchant-settings?${shopParam}#whatsapp`}>Settings</Link>
        </div>
      </div>

      {!account?.adConversionsEnabled ? (
        <div className="mk-alert mk-alert-warning" style={{ marginBottom: 16 }}>
          Ad sales are listed here but not sent to Meta. Switch on <Link href={`/admin/merchant-settings?${shopParam}#whatsapp`}>Report WhatsApp ad sales to Meta</Link> so Meta can optimise your Click-to-WhatsApp ads for purchases.
        </div>
      ) : null}

      <div className="mk-kpi-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Chats from ads", String(chats.length)],
          ["Orders", String(orderList.length)],
          ["Revenue", rupees(totalRevenue)],
          ["Chat → order", chats.length ? `${Math.round((orderList.length / chats.length) * 100)}%` : "—"],
        ].map(([label, value]) => (
          <div key={label} className="mk-stat-card"><div className="mk-stat-label">{label}</div><div className="mk-stat-value">{value}</div></div>
        ))}
      </div>

      <section className="mk-card" style={{ marginBottom: 16 }}>
        <h2 className="mk-section-title">By ad</h2>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead><tr><th>Ad</th><th>Chats</th><th>Orders</th><th>Revenue</th><th>Chat → order</th></tr></thead>
            <tbody>
              {list.length === 0 ? <tr><td colSpan={5}>No chats from Click-to-WhatsApp ads yet.</td></tr> : list.map((row) => (
                <tr key={row.key}>
                  <td>{row.headline}<br /><span className="mk-help">{row.key === "unknown" ? "" : `Ad id ${row.key}`}</span></td>
                  <td>{row.chats}</td>
                  <td>{row.orders}</td>
                  <td>{rupees(row.revenue)}</td>
                  <td>{row.chats ? `${Math.round((row.orders / row.chats) * 100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mk-card">
        <h2 className="mk-section-title">Orders from ads</h2>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead><tr><th>Order</th><th>Total</th><th>Ad</th><th>Meta</th><th>When</th></tr></thead>
            <tbody>
              {orderList.length === 0 ? <tr><td colSpan={5}>No orders from WhatsApp ads yet.</td></tr> : orderList.map((order) => (
                <tr key={`${order.orderName}-${order.at.toISOString()}`}>
                  <td>{order.orderName || "—"}</td>
                  <td>{rupees(order.total)}</td>
                  <td>{order.headline}</td>
                  <td>{capiLabel[order.capi] ?? order.capi}</td>
                  <td>{order.at.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
