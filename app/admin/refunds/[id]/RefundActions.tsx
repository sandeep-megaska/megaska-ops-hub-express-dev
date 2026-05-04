"use client";
import { useState } from "react";

export default function RefundActions({ id, status, shopDomain }: { id: string; status: string; shopDomain?: string }) {
  const [note, setNote] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const act = async (path: string, body?: Record<string, string>) => {
    const response = await fetch(`/api/admin/refunds/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(shopDomain ? { "x-shopify-shop-domain": shopDomain } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Action completed. Refresh to see latest status." : data?.error || "Action failed");
  };
  return <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 8 }}><h3>Actions</h3><p>Current status: {status}. Manual payout mode.</p><button type="button" onClick={() => act("approve")} disabled={status !== "DETAILS_SUBMITTED"}>Approve</button><div><input placeholder="Reject note" value={note} onChange={(e) => setNote(e.target.value)} /><button type="button" onClick={() => act("reject", { note })} disabled={status !== "DETAILS_SUBMITTED"}>Reject</button></div><div><input placeholder="UTR / Reference" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} /><button type="button" onClick={() => act("mark-paid", { referenceId, note })} disabled={status !== "APPROVED"}>Mark Paid</button></div><div><input placeholder="Failure reason" value={reason} onChange={(e) => setReason(e.target.value)} /><button type="button" onClick={() => act("mark-failed", { reason })} disabled={status !== "APPROVED"}>Mark Failed</button></div>{message ? <p>{message}</p> : null}</section>;
}
