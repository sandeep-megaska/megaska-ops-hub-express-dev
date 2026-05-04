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

export default async function AdminExchangesPage() {
  const headerStore = await headers();
  const requestedShopDomain = normalizeShopDomain(
    headerStore.get("x-shopify-shop-domain") || ""
  );

  const currentShop = requestedShopDomain
    ? await getShopByDomain(requestedShopDomain)
    : await resolveShopConfig();

  if (!currentShop?.id) {
    return (
      <main className="p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-950">Exchange Requests</h1>
          <p className="mt-1 text-slate-500">Manage customer exchange requests.</p>
        </div>
        <div className="rounded-xl border bg-white p-8 text-slate-500">
          Shop context is unavailable. Open this page from the embedded admin for a specific shop.
        </div>
      </main>
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

  const shopDomain = requestedShopDomain || "";
  const stats = {
    total: requests.length,
    pending: requests.filter((r) =>
      ["OPEN", "PENDING", "AWAITING_PAYMENT"].includes(r.status)
    ).length,
    approved: requests.filter((r) => ["APPROVED", "COMPLETED"].includes(r.status)).length,
  };

  return (
    <main className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-950">Exchange Requests</h1>
        <p className="mt-1 text-slate-500">Manage customer exchange requests.</p>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total</p>
          <p className="mt-1 text-2xl font-bold">{stats.total}</p>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Pending</p>
          <p className="mt-1 text-2xl font-bold">{stats.pending}</p>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Approved</p>
          <p className="mt-1 text-2xl font-bold">{stats.approved}</p>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-slate-500">No exchange requests found.</div>
      ) : null}

      {requests.length > 0 ? (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-5 py-4">Order</th>
                <th className="px-5 py-4">Customer</th>
                <th className="px-5 py-4">Phone</th>
                <th className="px-5 py-4">Items</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Requested</th>
                <th className="px-5 py-4 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {requests.map((request) => (
                <tr key={request.id} className="border-t">
                  <td className="px-5 py-4 font-medium">{request.orderNumber || "—"}</td>

                  <td className="px-5 py-4">
                    {request.customerNameSnapshot ||
                      request.customerEmailSnapshot ||
                      request.customerPhoneSnapshot ||
                      "—"}
                  </td>

                  <td className="px-5 py-4">{request.customerPhoneSnapshot || "—"}</td>

                  <td className="px-5 py-4">{Array.isArray(request.items) ? request.items.length : "—"}</td>

                  <td className="px-5 py-4">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{request.status}</span>
                  </td>

                  <td className="px-5 py-4">{formatDateTime(request.requestedAt || request.createdAt)}</td>

                  <td className="px-5 py-4 text-right">
                    <Link
                      href={
                        shopDomain
                          ? `/admin/exchanges/${request.id}?shop=${encodeURIComponent(shopDomain)}`
                          : `/admin/exchanges/${request.id}`
                      }
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
