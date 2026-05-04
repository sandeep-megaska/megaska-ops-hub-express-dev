import Link from "next/link";
import { headers } from "next/headers";
import { listAdminRefunds } from "../../../services/refund/admin-refunds";
import { getShopByDomain, normalizeShopDomain, resolveShopConfig } from "../../../services/shopify/shop";

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

export default async function AdminRefundsPage() {
  const headerStore = await headers();
  const requestedShopDomain = normalizeShopDomain(headerStore.get("x-shopify-shop-domain") || "");
  const shop = requestedShopDomain ? await getShopByDomain(requestedShopDomain) : await resolveShopConfig();

  if (!shop?.id) {
    return <main style={{ padding: 24 }}>Shop context is unavailable. Open this page from embedded admin for a specific shop.</main>;
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

  const shopDomain = requestedShopDomain || "";

  return <main style={{ padding: 24, display: "grid", gap: 16 }}><h1>Admin Refunds</h1><p>Manual payout only.</p><div>Total: {counts.total} | Pending Approval: {counts.pendingApproval} | Awaiting Payout: {counts.pendingPayout} | Paid: {counts.paid} | Rejected/Failed: {counts.closed}</div><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">Created</th><th align="left">ID</th><th align="left">Source</th><th align="left">Method</th><th align="left">Amount</th><th align="left">Status</th><th align="left">Action</th></tr></thead><tbody>{refunds.map((item) => <tr key={item.id} style={{ borderTop: "1px solid #ddd" }}><td>{formatDate(item.createdAt)}</td><td>{item.id}</td><td>{item.source}{item.sourceId ? ` (${item.sourceId})` : ""}</td><td>{item.method}</td><td>{item.amount} {item.currency}</td><td>{item.status}<br />D:{formatDate(item.detailsSubmittedAt)}<br />A:{formatDate(item.approvedAt)}<br />P:{formatDate(item.paidAt)}</td><td><Link href={shopDomain ? `/admin/refunds/${item.id}?shop=${encodeURIComponent(shopDomain)}` : `/admin/refunds/${item.id}`}>Open</Link></td></tr>)}</tbody></table></main>;
}
