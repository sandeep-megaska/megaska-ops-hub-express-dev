"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminAuthHeaders } from "../../../../lib/admin-fetch";

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
      headers: { ...requestHeaders, ...(await adminAuthHeaders()) },
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
        headers: { ...requestHeaders, ...(await adminAuthHeaders()) },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data?.error || "Store credit settlement failed");
        return;
      }
      setMessage(data?.alreadySettled ? "Settled as Store Credit" : "COD refund settled as Store Credit.");
      router.refresh();
    } finally {
      setSettlingStoreCredit(false);
    }
  };

  const canSettleStoreCredit = method === "COD" && STORE_CREDIT_ELIGIBLE_STATUSES.has(status) && !walletTransactionId;
  const settledAsStoreCredit = method === "COD" && Boolean(walletTransactionId);

  return (
    <section className="mk-card">
      <h3 className="mk-section-title">Actions</h3>
      <p className="mk-section-subtitle">Current status: {status}. Manual payout mode.</p>

      <div className="mk-page" style={{ gap: 16 }}>
        <div>
          <button type="button" className="mk-btn mk-btn-success" onClick={() => act("approve")} disabled={status !== "DETAILS_SUBMITTED"}>Approve</button>
        </div>

        <div className="mk-field">
          <label className="mk-label">Reject note</label>
          <input className="mk-input" placeholder="Reject note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="mk-btn mk-btn-danger" onClick={() => act("reject", { note })} disabled={status !== "DETAILS_SUBMITTED"} style={{ justifySelf: "start" }}>Reject</button>
        </div>

        <div className="mk-field">
          <label className="mk-label">UTR / Reference</label>
          <input className="mk-input" placeholder="UTR / Reference" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} />
          <button type="button" className="mk-btn mk-btn-primary" onClick={() => act("mark-paid", { referenceId, note })} disabled={status !== "APPROVED"} style={{ justifySelf: "start" }}>Mark Paid</button>
        </div>

        <div className="mk-field">
          <label className="mk-label">Failure reason</label>
          <input className="mk-input" placeholder="Failure reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="mk-btn mk-btn-danger" onClick={() => act("mark-failed", { reason })} disabled={status !== "APPROVED"} style={{ justifySelf: "start" }}>Mark Failed</button>
        </div>

        {canSettleStoreCredit ? (
          <div>
            <button type="button" className="mk-btn mk-btn-primary" onClick={settleStoreCredit} disabled={settlingStoreCredit}>{settlingStoreCredit ? "Settling…" : "Settle as Store Credit"}</button>
          </div>
        ) : null}
        {settledAsStoreCredit ? <p className="mk-help">Settled as Store Credit{walletTransactionId ? ` (${walletTransactionId})` : ""}</p> : null}
        {message ? <p className="mk-alert mk-alert-info">{message}</p> : null}
      </div>
    </section>
  );
}
