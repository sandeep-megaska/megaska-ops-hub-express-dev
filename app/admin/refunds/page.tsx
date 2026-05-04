"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type RefundSummary = { id: string; source: string; sourceId: string | null; method: string; status: string; currency: string; amount: number; detailsSubmittedAt: string | null; approvedAt: string | null; paidAt: string | null; createdAt: string; };
const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");

export default function AdminRefundsPage() {
  const [refunds, setRefunds] = useState<RefundSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { void (async () => { const response = await fetch("/api/admin/refunds", { cache: "no-store" }); const data = await response.json().catch(() => ({})); if (!response.ok) { setError(data?.error || "Failed to load refunds"); setLoading(false); return; } setRefunds(Array.isArray(data?.refunds) ? data.refunds : []); setLoading(false); })(); }, []);
  const counts = useMemo(() => refunds.reduce((a, i) => { a.total += 1; if (i.status === "DETAILS_SUBMITTED") a.pendingApproval += 1; if (i.status === "APPROVED") a.pendingPayout += 1; if (i.status === "PAID") a.paid += 1; if (i.status === "REJECTED" || i.status === "FAILED") a.closed += 1; return a; }, { total: 0, pendingApproval: 0, pendingPayout: 0, paid: 0, closed: 0 }), [refunds]);

  return <main style={{ padding: 24, display: "grid", gap: 16 }}><h1>Admin Refunds</h1><p>Manual payout only.</p><div>Total: {counts.total} | Pending Approval: {counts.pendingApproval} | Awaiting Payout: {counts.pendingPayout} | Paid: {counts.paid} | Rejected/Failed: {counts.closed}</div>{loading ? <p>Loading…</p> : null}{error ? <p style={{ color: "crimson" }}>{error}</p> : null}<table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">Created</th><th align="left">ID</th><th align="left">Source</th><th align="left">Method</th><th align="left">Amount</th><th align="left">Status</th><th align="left">Action</th></tr></thead><tbody>{refunds.map((item) => <tr key={item.id} style={{ borderTop: "1px solid #ddd" }}><td>{formatDate(item.createdAt)}</td><td>{item.id}</td><td>{item.source}{item.sourceId ? ` (${item.sourceId})` : ""}</td><td>{item.method}</td><td>{item.amount} {item.currency}</td><td>{item.status}<br />D:{formatDate(item.detailsSubmittedAt)}<br />A:{formatDate(item.approvedAt)}<br />P:{formatDate(item.paidAt)}</td><td><Link href={`/admin/refunds/${item.id}`}>Open</Link></td></tr>)}</tbody></table></main>;
}
