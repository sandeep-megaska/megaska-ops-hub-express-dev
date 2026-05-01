import { prisma } from "../../../services/db/prisma";
import { headers } from "next/headers";
import { getShopByDomain, normalizeShopDomain, resolveShopConfig } from "../../../services/shopify/shop";

const PENDING_OPEN_STATUSES = new Set(["OPEN", "PENDING", "AWAITING_PAYMENT"]);
const APPROVED_CLOSED_STATUSES = new Set(["APPROVED", "CLOSED"]);
const REJECTED_LOCKED_STATUSES = new Set(["REJECTED", "LOCKED"]);

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toLocaleString();
}

export default async function CancellationsPage() {
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
        <section className="mk-card">
          <h2 className="mk-section-title">Cancellation Queue</h2>
          <p className="mk-section-subtitle">
            Shop context is unavailable. Open this page from the embedded admin for a specific shop.
          </p>
        </section>
      </div>
    );
  }

  const requests = await prisma.orderActionRequest.findMany({
    where: {
      requestType: "CANCELLATION",
      shopId: currentShop.id,
    },
    orderBy: {
      requestedAt: "desc",
    },
    take: 300,
    select: {
      id: true,
      orderNumber: true,
      customerNameSnapshot: true,
      customerPhoneSnapshot: true,
      customerEmailSnapshot: true,
      reason: true,
      customerNote: true,
      adminNote: true,
      status: true,
      eligibilityDecision: true,
      eligibilityReason: true,
      requestedAt: true,
      updatedAt: true,
    },
  });

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const stats = requests.reduce(
    (acc, request) => {
      if (PENDING_OPEN_STATUSES.has(request.status)) {
        acc.pendingOpen += 1;
      }

      if (APPROVED_CLOSED_STATUSES.has(request.status)) {
        acc.approvedClosed += 1;
      }

      if (
        REJECTED_LOCKED_STATUSES.has(request.status) ||
        request.eligibilityDecision === "LOCKED"
      ) {
        acc.rejectedLocked += 1;
      }

      if (request.requestedAt >= startOfToday) {
        acc.todaysVolume += 1;
      }

      return acc;
    },
    {
      pendingOpen: 0,
      approvedClosed: 0,
      rejectedLocked: 0,
      todaysVolume: 0,
    }
  );

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Cancellations</h1>
          <p className="mk-page-subtitle">
            Review customer-initiated cancellation requests from OMS.
          </p>
        </div>

        <div className="mk-header-actions">
          <button className="mk-btn" disabled>
            View Policies
          </button>
          <button className="mk-btn mk-btn-primary" disabled>
            Export Requests
          </button>
        </div>
      </div>

      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Pending / Open</p>
          <p className="mk-stat-value">{stats.pendingOpen}</p>
          <p className="mk-stat-meta">Waiting for team action</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Approved / Closed</p>
          <p className="mk-stat-value">{stats.approvedClosed}</p>
          <p className="mk-stat-meta">Finalized for cancellation flow</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Rejected / Locked</p>
          <p className="mk-stat-value">{stats.rejectedLocked}</p>
          <p className="mk-stat-meta">Rejected or not eligible to cancel</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Today’s Volume</p>
          <p className="mk-stat-value">{stats.todaysVolume}</p>
          <p className="mk-stat-meta">New cancellation entries today</p>
        </div>
      </section>

      <section className="mk-card">
        <h2 className="mk-section-title">Cancellation Queue</h2>
        <p className="mk-section-subtitle">
          Customer cancellation requests (future-ready for Customer vs Megaska origin).
        </p>

        {requests.length === 0 ? (
          <div className="mk-list-row">
            <p className="mk-list-subtitle">
              No cancellation requests found yet.
            </p>
          </div>
        ) : (
          <div className="mk-list">
            {requests.map((request) => (
              <div className="mk-list-row" key={request.id}>
                <div>
                  <p className="mk-list-title">Order #{request.orderNumber || "—"}</p>
                  <p className="mk-list-subtitle">
                    Customer: {request.customerNameSnapshot || "—"}
                  </p>
                  <p className="mk-list-subtitle">
                    Phone: {request.customerPhoneSnapshot || "—"}
                  </p>
                  <p className="mk-list-subtitle">
                    Email: {request.customerEmailSnapshot || "—"}
                  </p>
                  <p className="mk-list-subtitle">Reason: {request.reason || "—"}</p>
                  <p className="mk-list-subtitle">
                    Customer Note: {request.customerNote || "—"}
                  </p>
                  <p className="mk-list-subtitle">Admin Note: {request.adminNote || "—"}</p>
                  <p className="mk-list-subtitle">
                    Eligibility: {request.eligibilityDecision || "—"}
                  </p>
                  <p className="mk-list-subtitle">
                    Eligibility Reason: {request.eligibilityReason || "—"}
                  </p>
                  <p className="mk-list-subtitle">
                    Requested At: {formatDateTime(request.requestedAt)}
                  </p>
                  <p className="mk-list-subtitle">
                    Updated At: {formatDateTime(request.updatedAt)}
                  </p>
                </div>

                <span className="mk-badge mk-badge-warning">{request.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
