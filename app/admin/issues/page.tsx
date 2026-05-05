import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "../../../services/db/prisma";
import {
  getShopByDomain,
  normalizeShopDomain,
  resolveShopConfig,
} from "../../../services/shopify/shop";

const OPEN_STATUSES = new Set(["OPEN", "PENDING", "AWAITING_CUSTOMER", "AWAITING_APPROVAL"]);
const APPROVED_STATUSES = new Set(["APPROVED", "COMPLETED"]);
const REJECTED_CLOSED_STATUSES = new Set(["REJECTED", "CLOSED", "CANCELLED", "LOCKED"]);

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toLocaleString();
}

function getStatusBadge(status: string) {
  if (APPROVED_STATUSES.has(status)) return "success";
  if (REJECTED_CLOSED_STATUSES.has(status)) return "neutral";
  if (OPEN_STATUSES.has(status)) return "warning";
  return "danger";
}

export default async function IssuesPage() {
  const headerStore = await headers();
  const requestedShopDomain = normalizeShopDomain(
    headerStore.get("x-shopify-shop-domain") || ""
  );

  const currentShop = requestedShopDomain
    ? await getShopByDomain(requestedShopDomain)
    : await resolveShopConfig();

  if (!currentShop?.id) {
    return (
      <div className="mk-page">
        <div className="mk-page-header">
          <div>
            <h1 className="mk-page-title">Issues</h1>
            <p className="mk-page-subtitle">
              Track customer-reported issues, resolutions, and support operations.
            </p>
          </div>
        </div>

        <section className="mk-card">
          <h2 className="mk-section-title">Issue Queue</h2>
          <p className="mk-section-subtitle">
            Shop context is unavailable. Open this page from the embedded admin for a specific shop.
          </p>
        </section>
      </div>
    );
  }

  const issues = await prisma.orderActionRequest.findMany({
    where: {
      requestType: "ISSUE",
      OR: [
        { shopId: currentShop.id },
        {
          shopId: null,
          OR: [
            { customerProfile: { shopId: currentShop.id } },
            { megaskaOrder: { shopId: currentShop.id } },
          ],
        },
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      customerNameSnapshot: true,
      customerEmailSnapshot: true,
      customerPhoneSnapshot: true,
      reason: true,
      status: true,
      requestedAt: true,
      updatedAt: true,
      items: {
        take: 1,
        select: {
          productTitle: true,
          requestedSize: true,
        },
      },
      customerProfile: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phoneE164: true,
        },
      },
      refundRequests: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          method: true,
          amount: true,
          currency: true,
          createdAt: true,
        },
      },
    },
    orderBy: { requestedAt: "desc" },
    take: 300,
  });

  const shopDomain = requestedShopDomain || currentShop.shopDomain || "";

  const stats = issues.reduce(
    (acc, issue) => {
      acc.total += 1;
      if (OPEN_STATUSES.has(issue.status)) acc.open += 1;
      if (APPROVED_STATUSES.has(issue.status)) acc.approved += 1;
      if (REJECTED_CLOSED_STATUSES.has(issue.status)) acc.rejectedClosed += 1;
      if (issue.refundRequests.length > 0) acc.refundsCreated += 1;
      return acc;
    },
    { total: 0, open: 0, approved: 0, rejectedClosed: 0, refundsCreated: 0 }
  );

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Issues</h1>
          <p className="mk-page-subtitle">
            Track customer-reported issues, resolutions, and support operations.
          </p>
        </div>

        <div className="mk-header-actions">
          <button className="mk-btn">Refresh</button>
        </div>
      </div>

      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Total</p>
          <p className="mk-stat-value">{stats.total}</p>
          <p className="mk-stat-meta">All issue requests in current shop scope</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Open</p>
          <p className="mk-stat-value">{stats.open}</p>
          <p className="mk-stat-meta">Require active support review</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Approved</p>
          <p className="mk-stat-value">{stats.approved}</p>
          <p className="mk-stat-meta">Accepted and in/after resolution flow</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Rejected / Closed</p>
          <p className="mk-stat-value">{stats.rejectedClosed}</p>
          <p className="mk-stat-meta">Declined or closed requests</p>
        </div>
      </section>

      <section className="mk-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 className="mk-section-title">Issue Queue</h2>
            <p className="mk-section-subtitle">
              Real customer issue tickets in current operational scope.
            </p>
          </div>
          <p className="mk-section-subtitle" style={{ margin: 0 }}>
            Refunds created: <strong>{stats.refundsCreated}</strong>
          </p>
        </div>

        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Issue ID</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Requested</th>
                <th>Refund</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {issues.length === 0 ? (
                <tr>
                  <td colSpan={8}>No issue requests found.</td>
                </tr>
              ) : (
                issues.map((issue) => {
                  const customerName =
                    issue.customerNameSnapshot ||
                    [issue.customerProfile?.firstName, issue.customerProfile?.lastName]
                      .filter(Boolean)
                      .join(" ") ||
                    issue.customerEmailSnapshot ||
                    issue.customerPhoneSnapshot ||
                    issue.customerProfile?.email ||
                    issue.customerProfile?.phoneE164 ||
                    "—";

                  const refund = issue.refundRequests[0];
                  return (
                    <tr key={issue.id}>
                      <td>{issue.id}</td>
                      <td>{issue.orderNumber || "—"}</td>
                      <td>{customerName}</td>
                      <td>{issue.reason || issue.items[0]?.productTitle || "—"}</td>
                      <td>
                        <span className={`mk-badge mk-badge-${getStatusBadge(issue.status)}`}>
                          {issue.status}
                        </span>
                      </td>
                      <td>{formatDateTime(issue.requestedAt || issue.updatedAt)}</td>
                      <td>{refund ? `${refund.status} (${refund.method})` : "Not created"}</td>
                      <td>
                        <Link
                          href={
                            shopDomain
                              ? `/admin/issues/${issue.id}?shop=${encodeURIComponent(shopDomain)}`
                              : `/admin/issues/${issue.id}`
                          }
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
