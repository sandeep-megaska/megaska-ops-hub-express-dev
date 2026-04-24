"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ExchangeRequest = {
  id: string;
  orderNumber?: string | null;
  customerNameSnapshot?: string | null;
  customerPhoneSnapshot?: string | null;
  customerEmailSnapshot?: string | null;
  status: string;
  requestedAt?: string | null;
  createdAt?: string | null;
  items?: unknown[];
};

function normalizeShopDomain(input: string | null | undefined) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function getShopDomainFromBrowser() {
  const fromLocalStorage = normalizeShopDomain(
    localStorage.getItem("megaska_shop_domain")
  );
  if (fromLocalStorage) return fromLocalStorage;

  const fromQuery = normalizeShopDomain(
    new URLSearchParams(window.location.search).get("shop")
  );
  if (fromQuery) return fromQuery;

  const fromShopify = normalizeShopDomain(
    (window as Window & { Shopify?: { shop?: string } }).Shopify?.shop
  );
  if (fromShopify) return fromShopify;

  return "";
}

export default function AdminExchangesPage() {
  const [requests, setRequests] = useState<ExchangeRequest[]>([]);
  const [adminKey, setAdminKey] = useState("");
  const [shopDomain, setShopDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const stats = useMemo(
    () => ({
      total: requests.length,
      pending: requests.filter((r) =>
        ["OPEN", "PENDING", "AWAITING_PAYMENT"].includes(r.status)
      ).length,
      approved: requests.filter((r) =>
        ["APPROVED", "COMPLETED"].includes(r.status)
      ).length,
    }),
    [requests]
  );

  async function loadRequests(key = adminKey, domain = shopDomain) {
    setError("");

    if (!key.trim()) {
      setError("Admin key is required");
      return;
    }

    if (!domain.trim()) {
      setError("Shop domain is required");
      return;
    }

    try {
      setLoading(true);

      localStorage.setItem("megaska_admin_key", key.trim());
      localStorage.setItem("megaska_shop_domain", domain.trim());

      const res = await fetch("/api/admin/exchange-requests", {
        method: "GET",
        cache: "no-store",
        headers: {
          "x-admin-key": key.trim(),
          "x-shopify-shop-domain": normalizeShopDomain(domain),
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to load exchange requests");
      }

      setRequests(Array.isArray(data?.requests) ? data.requests : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load exchange requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const storedKey = localStorage.getItem("megaska_admin_key") || "";
    const detectedShop = getShopDomainFromBrowser();

    setAdminKey(storedKey);
    setShopDomain(detectedShop);

    if (storedKey && detectedShop) {
      loadRequests(storedKey, detectedShop);
    }
  }, []);

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

      <div className="mb-6 rounded-xl border bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Admin Key</span>
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
              placeholder="ADMIN_OPS_KEY"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Shop Domain</span>
            <input
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
              placeholder="bigonbuy-fashions.myshopify.com"
            />
          </label>

          <button
            type="button"
            onClick={() => loadRequests()}
            disabled={loading}
            className="self-end rounded-lg bg-slate-950 px-5 py-2 text-white disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
          {error}
        </div>
      ) : null}

      {!loading && !error && requests.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-slate-500">
          No exchange requests found.
        </div>
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
                  <td className="px-5 py-4 font-medium">
                    {request.orderNumber || "—"}
                  </td>
                  <td className="px-5 py-4">
                    {request.customerNameSnapshot ||
                      request.customerEmailSnapshot ||
                      "—"}
                  </td>
                  <td className="px-5 py-4">
                    {request.customerPhoneSnapshot || "—"}
                  </td>
                  <td className="px-5 py-4">
                    {Array.isArray(request.items) ? request.items.length : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">
                      {request.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {request.requestedAt || request.createdAt
                      ? new Date(
                          request.requestedAt || request.createdAt || ""
                        ).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/admin/exchanges/${request.id}?shop=${encodeURIComponent(
                        normalizeShopDomain(shopDomain)
                      )}`}
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
