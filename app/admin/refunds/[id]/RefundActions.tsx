"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const STORE_CREDIT_ELIGIBLE_STATUSES = new Set(["APPROVED", "PAYOUT_PENDING", "MANUAL_PENDING"]);

type RefundActionsProps = {
  id: string;
  status: string;
  method: string;
  walletTransactionId?: string | null;
  shopDomain?: string;
};

export default function RefundActions({ id, status, method, walletTransactionId, shopDomain }: RefundActionsProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [settlingStoreCredit, setSettlingStoreCredit] = useState(false);

  const requestHeaders = {
    "Content-Type": "application/json",
    ...(shopDomain ? { "x-shopify-shop-domain": shopDomain } : {}),
  };

  const act = async (path: string, body?: Record<string, string>) => {
    const response = await fetch(`/api/admin/refunds/${id}/${path}`, {
      method: "POST",
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Action completed. Refresh to see latest status." : data?.error || "Action failed");
    if (response.ok) router.refresh();
  };

  const settleStoreCredit = async () => {
    setSettlingStoreCredit(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/refund-requests/${id}/settle-store-credit`, {
        method: "POST",
        headers: requestHeaders,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data?.error || "Store credit settlement failed");
        return;
      }
      setMessage(data?.alreadySettled ? "Settled as Store Credit" : "COD refund settled as Megaska Store Credit.");
      router.refresh();
    } finally {
      setSettlingStoreCredit(false);
    }
  };

  const canSettleStoreCredit = method === "COD" && STORE_CREDIT_ELIGIBLE_STATUSES.has(status) && !walletTransactionId;
  const settledAsStoreCredit = method === "COD" && Boolean(walletTransactionId);

  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 8 }}>
      <h3>Actions</h3>
      <p>Current status: {status}. Manual payout mode.</p>
      <button type="button" onClick={() => act("approve")} disabled={status !== "DETAILS_SUBMITTED"}>Approve</button>
      <div><input placeholder="Reject note" value={note} onChange={(e) => setNote(e.target.value)} /><button type="button" onClick={() => act("reject", { note })} disabled={status !== "DETAILS_SUBMITTED"}>Reject</button></div>
      <div><input placeholder="UTR / Reference" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} /><button type="button" onClick={() => act("mark-paid", { referenceId, note })} disabled={status !== "APPROVED"}>Mark Paid</button></div>
      <div><input placeholder="Failure reason" value={reason} onChange={(e) => setReason(e.target.value)} /><button type="button" onClick={() => act("mark-failed", { reason })} disabled={status !== "APPROVED"}>Mark Failed</button></div>
      {canSettleStoreCredit ? <button type="button" onClick={settleStoreCredit} disabled={settlingStoreCredit}>{settlingStoreCredit ? "Settling…" : "Settle as Store Credit"}</button> : null}
      {settledAsStoreCredit ? <p>Settled as Store Credit{walletTransactionId ? ` (${walletTransactionId})` : ""}</p> : null}
      {message ? <p>{message}</p> : null}
    </section>
  );
}
