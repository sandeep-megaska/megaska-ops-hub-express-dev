import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "../../../services/db/prisma";
import {
  getShopByDomain,
  normalizeShopDomain,
  resolveShopConfig,
} from "../../../services/shopify/shop";

type ExchangeRequest = {
  id: string;
  orderNumber?: string | null;
  customerNameSnapshot?: string | null;
  customerPhoneSnapshot?: string | null;
  customerEmailSnapshot?: string | null;
  status: string;
  requestedAt?: Date | null;
  createdAt?: Date | null;
  items?: unknown[];
};

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toLocaleString();
}

function statusBadgeVariant(status: string) {
  const s = (status || "").toUpperCase();
  if (["APPROVED", "COMPLETED", "CLOSED", "PAYMENT_RECEIVED", "PICKUP_COMPLETED", "ITEM_RECEIVED", "REPLACEMENT_SHIPPED"].includes(s)) return "success";
  if (["REJECTED", "CANCELLED", "FAILED"].includes(s)) return "danger";
  if (["OPEN", "PENDING", "AWAITING_PAYMENT", "PICKUP_PENDING", "PICKUP_SCHEDULED", "REPLACEMENT_PROCESSING"].includes(s)) return "warning";
  return "neutral";
}

export default async function AdminExchangesPage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string; shopify_shop?: string }>;
}) {
  const headerStore = await headers();
  const parsedSearch = await searchParams;
  const requestedShopDomain = normalizeShopDomain(
    parsedSearch?.shop ||
      parsedSearch?.shopify_shop ||
      headerStore.get("x-shopify-shop-domain") ||
      ""
  );

  const currentShop = requestedShopDomain
    ? await getShopByDomain(requestedShopDomain)
    : await resolveShopConfig();

  if (!currentShop?.id) {
    return (
      <div className="mk-page">
        <div className="mk-page-header">
          <div>
            <h1 className="mk-page-title">Exchange Requests</h1>
            <p className="mk-page-subtitle">Manage customer exchange requests.</p>
          </div>
        </div>
        <div className="mk-empty">
          <p className="mk-empty-title">Shop context unavailable</p>
          <p>Open this page from the embedded admin for a specific shop.</p>
        </div>
      </div>
    );
  }

  const requests: ExchangeRequest[] = await prisma.orderActionRequest.findMany({
    where: {
      requestType: "EXCHANGE",
      shopId: currentShop.id,
    },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      shipments: true,
    },
    orderBy: { requestedAt: "desc" },
    take: 300,
  });

  const shopDomain = requestedShopDomain || currentShop.shopDomain || "";
  const stats = {
    total: requests.length,
    pending: requests.filter((r) =>
      ["OPEN", "PENDING", "AWAITING_PAYMENT"].includes(r.status)
    ).length,
    approved: requests.filter((r) => ["APPROVED", "COMPLETED"].includes(r.status)).length,
  };

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Exchange Requests</h1>
          <p className="mk-page-subtitle">Manage customer exchange requests.</p>
        </div>
      </div>

      <section className="mk-grid-3">
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Total</p>
          <p className="mk-stat-value">{stats.total}</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Pending</p>
          <p className="mk-stat-value">{stats.pending}</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Approved</p>
          <p className="mk-stat-value">{stats.approved}</p>
        </div>
      </section>

      {requests.length === 0 ? (
        <div className="mk-empty">
          <p className="mk-empty-title">No exchange requests found</p>
        </div>
      ) : (
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>Items</th>
                <th>Status</th>
                <th>Requested</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>

            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td style={{ fontWeight: 600 }}>{request.orderNumber || "—"}</td>

                  <td>
                    {request.customerNameSnapshot ||
                      request.customerEmailSnapshot ||
                      request.customerPhoneSnapshot ||
                      "—"}
                  </td>

                  <td>{request.customerPhoneSnapshot || "—"}</td>

                  <td>{Array.isArray(request.items) ? request.items.length : "—"}</td>

                  <td>
                    <span className={`mk-badge mk-badge-${statusBadgeVariant(request.status)}`}>{request.status}</span>
                  </td>

                  <td>{formatDateTime(request.requestedAt || request.createdAt)}</td>

                  <td style={{ textAlign: "right" }}>
                    <Link
                      href={
                        shopDomain
                          ? `/admin/exchanges/${request.id}?shop=${encodeURIComponent(shopDomain)}`
                          : `/admin/exchanges/${request.id}`
                      }
                      className="mk-btn mk-btn-sm"
                    >
                      View
                    </Link>
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
