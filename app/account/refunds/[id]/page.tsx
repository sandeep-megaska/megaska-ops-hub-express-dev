"use client";

import { useEffect, useState } from "react";

// Refund status for the shopper. LoopD2C never asks for bank or UPI details: a
// refund goes back through Shopify (original payment method or store credit), and
// if a store needs anything else it contacts the customer itself.
type RefundDetail = {
  id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  reason: string | null;
  createdAt: string;
};

const statusText: Record<string, string> = {
  DETAILS_PENDING: "The store will contact you about this refund.",
  DETAILS_SUBMITTED: "The store is processing this refund.",
  APPROVED: "Refund approved.",
  PAID: "Refund paid.",
};

export default function CustomerRefundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [refundId, setRefundId] = useState<string>("");
  const [item, setItem] = useState<RefundDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then((v) => setRefundId(v.id));
  }, [params]);

  useEffect(() => {
    if (!refundId) return;
    void (async () => {
      const response = await fetch(`/api/account/refunds/${refundId}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setError(data?.error || "Failed to load refund");
      else setItem(data);
      setLoading(false);
    })();
  }, [refundId]);

  return <main style={{ padding: 24, display: "grid", gap: 16 }}>
    <h1>Refund Details</h1>
    {loading ? <p>Loading…</p> : null}
    {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
    {item ? <>
      <section>
        <p><strong>Refund ID:</strong> {item.id}</p>
        <p><strong>Amount:</strong> {item.amount} {item.currency}</p>
        <p><strong>Status:</strong> {item.status}</p>
        <p><strong>Reason:</strong> {item.reason || "-"}</p>
        <p><strong>Requested:</strong> {new Date(item.createdAt).toLocaleString()}</p>
      </section>
      <p>{statusText[item.status] || "No action required."}</p>
    </> : null}
  </main>;
}
