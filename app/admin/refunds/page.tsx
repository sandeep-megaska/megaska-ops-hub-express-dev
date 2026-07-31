import Link from "next/link";
import { listAdminRefunds } from "../../../services/refund/admin-refunds";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";

type RefundSummary = {
  id: string;
  source: string;
  sourceId: string | null;
  method: string;
  status: string;
  currency: string;
  amount: number;
  detailsSubmittedAt: Date | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
};

const formatDate = (value: Date | null) => (value ? value.toLocaleString() : "—");

function statusBadgeVariant(status: string) {
  const s = (status || "").toUpperCase();
  if (["PAID", "APPROVED", "COMPLETED"].includes(s)) return "success";
  if (["REJECTED", "FAILED", "CANCELLED"].includes(s)) return "danger";
  if (["DETAILS_SUBMITTED", "PENDING", "PAYOUT_PENDING", "MANUAL_PENDING"].includes(s)) return "warning";
  return "neutral";
}

export default async function AdminRefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const resolved = await resolveAdminShopFromSearchParams(params);
  const shop = resolved.shop;

  if (!shop?.id) {
    return (
      <div className="mk-page">
        <div className="mk-page-header">
          <div>
            <h1 className="mk-page-title">Admin Refunds</h1>
            <p className="mk-page-subtitle">Manual payout only.</p>
          </div>
        </div>
        <div className="mk-empty">
          <p className="mk-empty-title">Shop context unavailable</p>
          <p>{formatAdminShopResolutionError(resolved)}</p>
        </div>
      </div>
    );
  }

  const refunds = (await listAdminRefunds(shop.id)) as RefundSummary[];
  const counts = refunds.reduce(
    (a, i) => {
      a.total += 1;
      if (i.status === "DETAILS_SUBMITTED") a.pendingApproval += 1;
      if (i.status === "APPROVED") a.pendingPayout += 1;
      if (i.status === "PAID") a.paid += 1;
      if (i.status === "REJECTED" || i.status === "FAILED") a.closed += 1;
      return a;
    },
    { total: 0, pendingApproval: 0, pendingPayout: 0, paid: 0, closed: 0 }
  );

  const shopDomain = resolved.shopDomain || "";

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Admin Refunds</h1>
          <p className="mk-page-subtitle">Manual payout only.</p>
        </div>
      </div>

      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card"><p className="mk-stat-label">Total</p><p className="mk-stat-value">{counts.total}</p></div>
        <div className="mk-card mk-stat-card"><p className="mk-stat-label">Pending Approval</p><p className="mk-stat-value">{counts.pendingApproval}</p></div>
        <div className="mk-card mk-stat-card"><p className="mk-stat-label">Awaiting Payout</p><p className="mk-stat-value">{counts.pendingPayout}</p></div>
        <div className="mk-card mk-stat-card"><p className="mk-stat-label">Paid</p><p className="mk-stat-value">{counts.paid}</p></div>
      </section>
      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card"><p className="mk-stat-label">Rejected / Failed</p><p className="mk-stat-value">{counts.closed}</p></div>
      </section>

      {refunds.length === 0 ? (
        <div className="mk-empty"><p className="mk-empty-title">No refunds found</p></div>
      ) : (
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>ID</th>
                <th>Source</th>
                <th>Method</th>
                <th>Amount</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{item.id}</td>
                  <td>{item.source}{item.sourceId ? ` (${item.sourceId})` : ""}</td>
                  <td>{item.method}</td>
                  <td>{item.amount} {item.currency}</td>
                  <td>
                    <span className={`mk-badge mk-badge-${statusBadgeVariant(item.status)}`}>{item.status}</span>
                    <p className="mk-help" style={{ marginTop: 6 }}>D: {formatDate(item.detailsSubmittedAt)}</p>
                    <p className="mk-help">A: {formatDate(item.approvedAt)}</p>
                    <p className="mk-help">P: {formatDate(item.paidAt)}</p>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link className="mk-btn mk-btn-sm" href={shopDomain ? `/admin/refunds/${item.id}?shop=${encodeURIComponent(shopDomain)}` : `/admin/refunds/${item.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
