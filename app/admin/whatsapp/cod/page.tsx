import Link from "next/link";
import { prisma } from "../../../../services/db/prisma";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../../services/shopify/admin-shop-context";
import {
  COD_CONFIRMATION_RESPONSE_EVENT,
  COD_CONFIRMATION_SENT_EVENT,
  COD_ENTITY_TYPE,
  numericOrderId,
} from "../../../../services/orders/whatsapp-cod-confirmation";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; badge: string }> = {
  confirmed: { label: "Confirmed", badge: "success" },
  cancel_requested: { label: "Cancel requested", badge: "danger" },
  no_response: { label: "No reply: call", badge: "warning" },
  waiting: { label: "Waiting for reply", badge: "neutral" },
};

function formatWhen(value: Date) {
  return new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export default async function CodConfirmationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const resolved = await resolveAdminShopFromSearchParams(params);
  const shop = resolved.shop;
  if (!shop?.id) {
    return <div className="mk-page"><section className="mk-card"><p className="mk-section-subtitle">{formatAdminShopResolutionError(resolved)}</p></section></div>;
  }
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [account, events] = await Promise.all([
    prisma.merchantWhatsAppAccount.findUnique({ where: { shopId: shop.id }, select: { enabled: true, codConfirmEnabled: true, codConfirmTemplate: true } }).catch(() => null),
    prisma.auditEvent.findMany({
      where: { entityType: COD_ENTITY_TYPE, eventType: { in: [COD_CONFIRMATION_SENT_EVENT, COD_CONFIRMATION_RESPONSE_EVENT] }, createdAt: { gte: since }, payload: { path: ["shopId"], equals: shop.id } },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { entityId: true, eventType: true, createdAt: true, payload: true },
    }).catch(() => []),
  ]);

  type Row = { orderId: string; orderName: string; total: string; sentAt: Date; status: string; answeredAt: Date | null };
  const rows = new Map<string, Row>();
  for (const event of [...events].reverse()) {
    const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>;
    if (!event.entityId) continue;
    if (event.eventType === COD_CONFIRMATION_SENT_EVENT) {
      rows.set(event.entityId, { orderId: event.entityId, orderName: String(payload.orderName ?? ""), total: String(payload.total ?? ""), sentAt: event.createdAt, status: "waiting", answeredAt: null });
    } else {
      const row = rows.get(event.entityId);
      // The latest answer wins (a customer may confirm after asking to cancel).
      if (row) { row.status = String(payload.response ?? "waiting"); row.answeredAt = event.createdAt; }
    }
  }
  const list = [...rows.values()].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  const count = (status: string) => list.filter((row) => row.status === status).length;
  const answered = count("confirmed") + count("cancel_requested");
  const storeHandle = shop.shopDomain.replace(/\.myshopify\.com$/, "");
  const shopParam = `shop=${encodeURIComponent(shop.shopDomain)}`;

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">COD confirmations</h1>
          <p className="mk-page-subtitle">
            Cash-on-delivery orders asked to confirm on WhatsApp in the last 7 days. Ship confirmed orders; cancel or call the rest before they ship. Orders are also tagged in Shopify (cod-confirmed, cod-cancel-requested, cod-no-response), so you can filter the Orders list.
          </p>
        </div>
        <div className="mk-header-actions">
          <Link className="mk-btn" href={`/admin/whatsapp?${shopParam}`}>WhatsApp inbox</Link>
          <Link className="mk-btn" href={`/admin/merchant-settings?${shopParam}#whatsapp`}>Settings</Link>
        </div>
      </div>

      {!account?.enabled || !account.codConfirmEnabled ? (
        <div className="mk-alert mk-alert-warning" style={{ marginBottom: 16 }}>
          COD confirmation is off. Switch it on in <Link href={`/admin/merchant-settings?${shopParam}#whatsapp`}>Merchant Settings → WhatsApp</Link> once the {account?.codConfirmTemplate || "cod_order_confirmation"} template is approved.
        </div>
      ) : null}

      <div className="mk-kpi-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Asked", String(list.length)],
          ["Confirmed", String(count("confirmed"))],
          ["Cancel requests", String(count("cancel_requested"))],
          ["No reply (call)", String(count("no_response"))],
          ["Reply rate", list.length ? `${Math.round((answered / list.length) * 100)}%` : "—"],
        ].map(([label, value]) => (
          <div key={label} className="mk-stat-card"><div className="mk-stat-label">{label}</div><div className="mk-stat-value">{value}</div></div>
        ))}
      </div>

      <section className="mk-card">
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead><tr><th>Order</th><th>Total</th><th>Asked</th><th>Status</th><th>Answered</th></tr></thead>
            <tbody>
              {list.length === 0 ? <tr><td colSpan={5}>No COD confirmations in the last 7 days.</td></tr> : list.map((row) => {
                const status = STATUS[row.status] ?? STATUS.waiting;
                return (
                  <tr key={row.orderId}>
                    <td><a href={`https://admin.shopify.com/store/${storeHandle}/orders/${numericOrderId(row.orderId)}`} target="_blank" rel="noopener noreferrer">{row.orderName || numericOrderId(row.orderId)}</a></td>
                    <td>{row.total || "—"}</td>
                    <td>{formatWhen(row.sentAt)}</td>
                    <td><span className={`mk-badge mk-badge-${status.badge}`}>{status.label}</span></td>
                    <td>{row.answeredAt ? formatWhen(row.answeredAt) : "—"}</td>
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
