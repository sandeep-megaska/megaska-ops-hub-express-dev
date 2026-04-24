"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ExchangeRequest = {
  id: string;
  orderId?: string | null;
  orderName?: string | null;
  shopifyOrderName?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  status: string;
  reason?: string | null;
  createdAt: string;
  items?: unknown[];
};

function getShopDomain() {
  return (
    localStorage.getItem("megaska_shop_domain") ||
    localStorage.getItem("shopDomain") ||
    window.location.hostname
  );
}

function getAdminKey() {
  return (
    localStorage.getItem("megaska_admin_key") ||
    localStorage.getItem("adminKey") ||
    ""
  );
}

export default function AdminExchangesPage() {
  const [requests, setRequests] = useState<ExchangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    return {
      total: requests.length,
      pending: requests.filter((r) =>
        ["PENDING", "REQUESTED", "OPEN"].includes(r.status)
      ).length,
      approved: requests.filter((r) =>
        ["APPROVED", "ACCEPTED"].includes(r.status)
      ).length,
    };
  }, [requests]);

  useEffect(() => {
    let cancelled = false;

    async function loadExchangeRequests() {
      try {
        setLoading(true);
        setError(null);

        const shopDomain = getShopDomain();
        const adminKey = getAdminKey();

        const headers: HeadersInit = {
          "x-shop-domain": shopDomain,
        };

        if (adminKey) {
          headers["x-admin-key"] = adminKey;
        }

        const res = await fetch("/api/admin/exchange-requests", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers,
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(data?.error || data?.message || "Failed to load exchange requests");
        }

        const list =
          Array.isArray(data) ? data :
          Array.isArray(data?.requests) ? data.requests :
          Array.isArray(data?.exchangeRequests) ? data.exchangeRequests :
          Array.isArray(data?.data) ? data.data :
          [];

        if (!cancelled) {
          setRequests(list);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load exchange requests");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadExchangeRequests();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-950">Exchange Requests</h1>
        <p className="mt-1 text-slate-500">Manage customer exchange requests.</p>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Total</div>
          <div className="mt-1 text-2xl font-bold">{stats.total}</div>
        </div>
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Pending</div>
          <div className="mt-1 text-2xl font-bold">{stats.pending}</div>
        </div>
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Approved</div>
          <div className="mt-1 text-2xl font-bold">{stats.approved}</div>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border bg-white p-6 text-slate-500">
          Loading exchange requests...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && requests.length === 0 && (
        <div className="rounded-xl border bg-white p-8 text-slate-500">
          No exchange requests found.
        </div>
      )}

      {!loading && !error && requests.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-5 py-4">Request</th>
                <th className="px-5 py-4">Order</th>
                <th className="px-5 py-4">Customer</th>
                <th className="px-5 py-4">Items</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Created</th>
                <th className="px-5 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id} className="border-t">
                  <td className="px-5 py-4 font-medium text-slate-950">
                    {request.id}
                  </td>
                  <td className="px-5 py-4">
                    {request.orderName || request.shopifyOrderName || request.orderId || "—"}
                  </td>
                  <td className="px-5 py-4">
                    {request.customerName || request.customerEmail || "—"}
                  </td>
                  <td className="px-5 py-4">
                    {Array.isArray(request.items) ? request.items.length : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {request.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {request.createdAt
                      ? new Date(request.createdAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/admin/exchanges/${request.id}`}
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
      )}
    </main>
  );
}
