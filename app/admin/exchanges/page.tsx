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

function getShopDomainFromEmbedContext() {
  if (typeof window === "undefined") return "";

  const fromShopify = normalizeShopDomain(
    (window as Window & { Shopify?: { shop?: string } }).Shopify?.shop
  );
  if (fromShopify) return fromShopify;

  const fromQuery = normalizeShopDomain(
    new URLSearchParams(window.location.search).get("shop")
  );
  if (fromQuery) return fromQuery;

  const fromHtml = normalizeShopDomain(
    document.documentElement.getAttribute("data-shop-domain")
  );
  if (fromHtml) return fromHtml;

  const fromBody = normalizeShopDomain(
    document.body.getAttribute("data-shop-domain")
  );
  if (fromBody) return fromBody;

  return normalizeShopDomain(localStorage.getItem("megaska_shop_domain"));
}

export default function AdminExchangesPage() {
  const [requests, setRequests] = useState<ExchangeRequest[]>([]);
  const [shopDomain, setShopDomain] = useState("");
  const [loading, setLoading] = useState(true);
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

  async function loadRequests(domain: string) {
    setError("");
    const cleanDomain = normalizeShopDomain(domain);

    if (!cleanDomain) {
      setError(
        "We couldn’t detect your Shopify shop context. Please open this page from your embedded Shopify admin app."
      );
      setRequests([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      localStorage.setItem("megaska_shop_domain", cleanDomain);

      const res = await fetch("/api/admin/exchange-requests", {
        method: "GET",
        cache: "no-store",
        headers: {
          "x-shopify-shop-domain": cleanDomain,
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to load exchange requests");
      }

      setRequests(Array.isArray(data?.requests) ? data.requests : []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load exchange requests"
      );
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const detectedShop = getShopDomainFromEmbedContext();

    setShopDomain(detectedShop);
    loadRequests(detectedShop);
  }, []);

  return (
    <main className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-950">
          Exchange Requests
        </h1>
        <p className="mt-1 text-slate-500">
          Manage customer exchange requests.
        </p>
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
        <p className="mt-3 text-xs text-slate-500">
          Shop context: {shopDomain || "not detected"}
        </p>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border bg-white p-8 text-slate-500">
          Loading exchange requests...
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
                        shopDomain
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
