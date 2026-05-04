"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type RefundItem = {
  id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  reason: string | null;
  createdAt: string;
};

export default function CustomerRefundListPage() {
  const [items, setItems] = useState<RefundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/account/refunds", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error || "Failed to load refunds");
        setLoading(false);
        return;
      }
      setItems(Array.isArray(data?.items) ? data.items : []);
      setLoading(false);
    })();
  }, []);

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <h1>My Refunds</h1>
      {loading ? <p>Loading…</p> : null}
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
      {!loading && !error && items.length === 0 ? <p>No refunds found.</p> : null}
      {items.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Created</th>
              <th align="left">Amount</th>
              <th align="left">Status</th>
              <th align="left">Reason</th>
              <th align="left">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderTop: "1px solid #ddd" }}>
                <td>{new Date(item.createdAt).toLocaleString()}</td>
                <td>{item.amount} {item.currency}</td>
                <td>{item.status}</td>
                <td>{item.reason || "-"}</td>
                <td><Link href={`/account/refunds/${item.id}`}>View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
