"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ExchangeRequest = {
  id: string;
  orderName?: string | null;
  orderId?: string | null;
  customerEmail?: string | null;
  status: string;
  createdAt: string;
  items?: unknown[];
};

export default function AdminExchangesPage() {
  const [requests, setRequests] = useState<ExchangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/admin/exchange-requests", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(data?.error || "Failed to load exchange requests");
        }

        const list =
          Array.isArray(data) ? data :
          Array.isArray(data?.requests) ? data.requests :
          Array.isArray(data?.exchangeRequests) ? data.exchangeRequests :
          [];

        if (!cancelled) setRequests(list);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load exchange requests");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Exchange Requests</h1>
        <p className="text-sm text-gray-500">
          Manage customer exchange requests.
        </p>
      </div>

      {loading && <div>Loading exchange requests...</div>}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && requests.length === 0 && (
        <div className="rounded border p-6 text-gray-500">
          No exchange requests found.
        </div>
      )}

      {!loading && !error && requests.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3">Request</th>
                <th className="p-3">Order</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Status</th>
                <th className="p-3">Created</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id} className="border-t">
                  <td className="p-3 font-medium">{request.id}</td>
                  <td className="p-3">{request.orderName || request.orderId || "—"}</td>
                  <td className="p-3">{request.customerEmail || "—"}</td>
                  <td className="p-3">{request.status}</td>
                  <td className="p-3">
                    {request.createdAt
                      ? new Date(request.createdAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/admin/exchanges/${request.id}`}
                      className="text-blue-600 hover:underline"
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
