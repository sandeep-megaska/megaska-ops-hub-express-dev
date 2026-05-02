import { headers } from "next/headers";
import { prisma } from "../../../services/db/prisma";
import { getShopByDomain, normalizeShopDomain, resolveShopConfig } from "../../../services/shopify/shop";

type RangeKey = "7d" | "30d" | "90d" | "custom";

type CancellationRow = {
  id: string;
  orderNumber: string;
  eventAt: Date;
  cancelledBy: "Customer" | "Megaska";
  customerName: string;
  phone: string;
  email: string;
  reason: string;
  customerNote: string;
  adminNote: string;
  status: string;
  source: "Customer Request" | "Shopify Cancellation" | "OMS";
};

const APPROVED_CLOSED_STATUSES = new Set(["APPROVED", "CLOSED"]);
const REJECTED_LOCKED_STATUSES = new Set(["REJECTED", "LOCKED"]);

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toLocaleString();
}

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateRange(searchParams: Record<string, string | string[] | undefined>) {
  const rangeRaw = Array.isArray(searchParams.range) ? searchParams.range[0] : searchParams.range;
  const range = (["7d", "30d", "90d", "custom"] as RangeKey[]).includes(rangeRaw as RangeKey)
    ? (rangeRaw as RangeKey)
    : "30d";

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  if (range === "custom") {
    const fromRaw = Array.isArray(searchParams.from) ? searchParams.from[0] : searchParams.from;
    const toRaw = Array.isArray(searchParams.to) ? searchParams.to[0] : searchParams.to;
    const from = fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : null;
    const to = toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : null;

    if (from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
      return { range, start: from, end: to, fromRaw, toRaw };
    }
  }

  const dayMap: Record<Exclude<RangeKey, "custom">, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
  };
  const days = dayMap[range === "custom" ? "30d" : range];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  return { range: range === "custom" ? "30d" : range, start, end, fromRaw: "", toRaw: "" };
}

async function fetchShopifyCancelledOrders(shopDomain: string, accessToken: string, start: Date, end: Date) {
  const query = `
    query CancelledOrders($query: String!) {
      orders(first: 100, sortKey: UPDATED_AT, reverse: true, query: $query) {
        nodes {
          id
          name
          cancelledAt
          cancelReason
          updatedAt
          displayFinancialStatus
          customer {
            firstName
            lastName
            email
            phone
          }
          email
          phone
          note
        }
      }
    }
  `;

  const rangeQuery = `updated_at:>=${start.toISOString()} updated_at:<=${end.toISOString()}`;

  const response = await fetch(`https://${shopDomain}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables: { query: rangeQuery } }),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    const message = `Shopify cancelled orders query failed with status ${response.status} ${response.statusText}${responseBody ? `: ${responseBody.slice(0, 500)}` : ""}`;
    console.error("[ADMIN CANCELLATIONS] Shopify API HTTP error", {
      shopDomain,
      status: response.status,
      statusText: response.statusText,
      responseBody,
    });
    throw new Error(message);
  }
  const payload = (await response.json()) as {
    data?: {
      orders?: {
        nodes?: Array<{
          id: string;
          name?: string | null;
          cancelledAt?: string | null;
          cancelReason?: string | null;
          updatedAt?: string | null;
          displayFinancialStatus?: string | null;
          customer?: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null } | null;
          email?: string | null;
          phone?: string | null;
          note?: string | null;
        }>;
      };
    };
  };

  if ((payload as { errors?: unknown }).errors) {
    const serializedErrors = JSON.stringify((payload as { errors?: unknown }).errors);
    console.error("[ADMIN CANCELLATIONS] Shopify GraphQL errors", { shopDomain, errors: serializedErrors });
    throw new Error(`Shopify GraphQL error: ${serializedErrors}`);
  }

  return (payload.data?.orders?.nodes || [])
    .map((order) => {
      const cancelledAt = toDate(order.cancelledAt);
      const updatedAt = toDate(order.updatedAt);
      const eventAt = cancelledAt || updatedAt;
      if (!eventAt || !cancelledAt) return null;

      const customerName = `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim();

      return {
        id: order.id,
        orderNumber: order.name || "—",
        eventAt,
        cancelledBy: "Megaska" as const,
        customerName: customerName || "—",
        phone: order.customer?.phone || order.phone || "—",
        email: order.customer?.email || order.email || "—",
        reason: order.cancelReason || "Reason not provided",
        customerNote: "—",
        adminNote: order.note || "—",
        status: order.displayFinancialStatus || "CANCELLED",
        source: "Shopify Cancellation" as const,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

export default async function CancellationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { range, start, end, fromRaw, toRaw } = getDateRange(params);

  const headerStore = await headers();
  const requestedShopDomain = normalizeShopDomain(headerStore.get("x-shopify-shop-domain") || "");
  const currentShop = requestedShopDomain ? await getShopByDomain(requestedShopDomain) : await resolveShopConfig();

  if (!currentShop?.id) {
    return <div className="mk-page"><section className="mk-card"><h2 className="mk-section-title">Cancellation Queue</h2><p className="mk-section-subtitle">Shop context is unavailable. Open this page from the embedded admin for a specific shop.</p></section></div>;
  }

  const [customerRequests, omsOrders] = await Promise.all([
    prisma.orderActionRequest.findMany({
      where: {
        requestType: "CANCELLATION",
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
        requestedAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { requestedAt: "desc" },
      take: 300,
      select: {
        id: true, orderNumber: true, customerNameSnapshot: true, customerPhoneSnapshot: true, customerEmailSnapshot: true,
        reason: true, customerNote: true, adminNote: true, status: true, requestedAt: true,
        customerProfileId: true,
        customerProfile: { select: { shopId: true } },
        megaskaOrder: { select: { shopId: true } },
      },
    }),
    prisma.megaskaOrder.findMany({
      where: {
        shopId: currentShop.id,
        status: "CANCELLED",
        OR: [{ statusUpdatedAt: { gte: start, lte: end } }, { updatedAt: { gte: start, lte: end } }],
      },
      include: { customerProfile: true },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
  ]);

  const safeCustomerRequests = customerRequests.filter((request) => {
    if (request.customerProfile?.shopId === currentShop.id) return true;
    if (request.megaskaOrder?.shopId === currentShop.id) return true;
    return request.orderNumber && omsOrders.some((order) => order.shopifyOrderName === request.orderNumber);
  });

  const cancellationRows: CancellationRow[] = safeCustomerRequests.map((request) => ({
    id: request.id,
    orderNumber: request.orderNumber || "—",
    eventAt: request.requestedAt,
    cancelledBy: "Customer",
    customerName: request.customerNameSnapshot || "—",
    phone: request.customerPhoneSnapshot || "—",
    email: request.customerEmailSnapshot || "—",
    reason: request.reason || "Reason not provided",
    customerNote: request.customerNote || "—",
    adminNote: request.adminNote || "—",
    status: request.status,
    source: "Customer Request",
  }));

  const omsRows: CancellationRow[] = omsOrders.map((order) => ({
    id: order.id,
    orderNumber: order.shopifyOrderName || "—",
    eventAt: order.statusUpdatedAt || order.updatedAt,
    cancelledBy: "Megaska",
    customerName: [order.customerProfile.firstName, order.customerProfile.lastName].filter(Boolean).join(" ") || "—",
    phone: order.customerProfile.phoneE164 || "—",
    email: order.customerProfile.email || "—",
    reason: "Reason not provided",
    customerNote: "—",
    adminNote: "—",
    status: order.status,
    source: "OMS",
  }));

  let shopifyRows: CancellationRow[] = [];
  let shopifyFetchError: string | null = null;
  if (currentShop.shopDomain && currentShop.accessToken) {
    try {
      shopifyRows = await fetchShopifyCancelledOrders(currentShop.shopDomain, currentShop.accessToken, start, end);
    } catch (error) {
      shopifyFetchError = error instanceof Error ? error.message : String(error);
      console.error("[ADMIN CANCELLATIONS] Failed to fetch Shopify cancelled orders", {
        shopId: currentShop.id,
        shopDomain: currentShop.shopDomain,
        errorMessage: shopifyFetchError,
      });
    }
  }

  const merged = [...cancellationRows, ...omsRows, ...shopifyRows].sort(
    (a, b) => b.eventAt.getTime() - a.eventAt.getTime()
  );
  const showDebugStatus = true; // Admin cancellations page is an admin-only surface.

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const stats = merged.reduce((acc, row) => {
    if (row.source === "Customer Request") acc.customerRequests += 1;
    if (row.cancelledBy === "Megaska") acc.megaskaCancellations += 1;
    if (APPROVED_CLOSED_STATUSES.has(row.status)) acc.approvedClosed += 1;
    if (REJECTED_LOCKED_STATUSES.has(row.status)) acc.rejectedLocked += 1;
    if (row.eventAt >= startOfToday) acc.todaysCancellations += 1;
    return acc;
  }, { customerRequests: 0, megaskaCancellations: 0, approvedClosed: 0, rejectedLocked: 0, todaysCancellations: 0 });

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Cancellations</h1>
          <p className="mk-page-subtitle">Customer requests and Megaska/Shopify cancellations (read-only).</p>
        </div>
      </div>

      <section className="mk-card">
        <form method="get" className="mk-grid-4">
          <label className="mk-list-subtitle">
            Range
            <select name="range" defaultValue={range} className="mk-input">
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="mk-list-subtitle">
            From
            <input type="date" name="from" defaultValue={fromRaw} className="mk-input" />
          </label>
          <label className="mk-list-subtitle">
            To
            <input type="date" name="to" defaultValue={toRaw} className="mk-input" />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button className="mk-btn mk-btn-primary" type="submit">Apply</button>
          </div>
        </form>
        <p className="mk-section-subtitle">
          Showing {formatDateTime(start)} to {formatDateTime(end)}.
        </p>
      </section>

      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card"><p className="mk-stat-label">Customer cancellation requests</p><p className="mk-stat-value">{stats.customerRequests}</p></div>
        <div className="mk-card mk-stat-card"><p className="mk-stat-label">Megaska cancellations</p><p className="mk-stat-value">{stats.megaskaCancellations}</p></div>
        <div className="mk-card mk-stat-card"><p className="mk-stat-label">Approved / Closed</p><p className="mk-stat-value">{stats.approvedClosed}</p></div>
        <div className="mk-card mk-stat-card"><p className="mk-stat-label">Rejected / Locked</p><p className="mk-stat-value">{stats.rejectedLocked}</p></div>
      </section>
      {showDebugStatus ? (
        <section className="mk-card">
          <h2 className="mk-section-title">Debug Status</h2>
          <p className="mk-list-subtitle">currentShop.id: {currentShop.id}</p>
          <p className="mk-list-subtitle">currentShop.shopDomain: {currentShop.shopDomain || "—"}</p>
          <p className="mk-list-subtitle">customer cancellation count: {cancellationRows.length}</p>
          <p className="mk-list-subtitle">OMS cancellation count: {omsRows.length}</p>
          <p className="mk-list-subtitle">Shopify cancellation count: {shopifyRows.length}</p>
          <p className="mk-list-subtitle">Shopify API error: {shopifyFetchError || "none"}</p>
        </section>
      ) : null}
      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card"><p className="mk-stat-label">Today&apos;s cancellations</p><p className="mk-stat-value">{stats.todaysCancellations}</p></div>
      </section>

      <section className="mk-card">
        <h2 className="mk-section-title">Cancellation Queue</h2>
        {merged.length === 0 ? (
          <div className="mk-list-row"><p className="mk-list-subtitle">No cancellations found for the selected date range.</p></div>
        ) : (
          <div className="mk-list">
            {merged.map((row) => (
              <div className="mk-list-row" key={`${row.source}-${row.id}`}>
                <div>
                  <p className="mk-list-title">Order {row.orderNumber}</p>
                  <p className="mk-list-subtitle">Cancelled/Requested At: {formatDateTime(row.eventAt)}</p>
                  <p className="mk-list-subtitle">Cancelled By: {row.cancelledBy}</p>
                  <p className="mk-list-subtitle">Customer: {row.customerName}</p>
                  <p className="mk-list-subtitle">Phone: {row.phone}</p>
                  <p className="mk-list-subtitle">Email: {row.email}</p>
                  <p className="mk-list-subtitle">Reason: {row.reason}</p>
                  <p className="mk-list-subtitle">Customer Note: {row.customerNote}</p>
                  <p className="mk-list-subtitle">Admin Note: {row.adminNote}</p>
                  <p className="mk-list-subtitle">Source: {row.source}</p>
                </div>
                <span className="mk-badge mk-badge-warning">{row.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
