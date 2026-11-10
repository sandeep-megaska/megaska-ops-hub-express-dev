"use client";

import { useState } from "react";
import { adminAuthHeaders } from "../../../../lib/admin-fetch";

type Props = {
  requestId: string;
  shopDomain: string;
  eligible: boolean;
  early: { atIso: string; reason: string | null } | null;
  returnOutstanding: boolean;
  reverseStatus: string | null;
};

// "Ship replacement before the return arrives": for a return Delhivery has picked up
// but is slow to deliver back, when the customer has waited long enough.
export default function EarlyReplacementCard({ requestId, shopDomain, eligible, early, returnOutstanding, reverseStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (early) {
    return (
      <section className="mk-card" style={{ display: "grid", gap: 6 }}>
        <h2 className="mk-section-title">Replacement sent before the return arrived</h2>
        <p className="mk-help">Cleared on {new Date(early.atIso).toLocaleString("en-IN")}{early.reason ? `: ${early.reason}` : ""}</p>
        {returnOutstanding ? (
          <div className={`mk-alert ${reverseStatus === "FAILED" ? "mk-alert-error" : "mk-alert-warning"}`}>
            {reverseStatus === "FAILED"
              ? "The return will not reach you (Delhivery reports it failed or returned to the customer). Contact the customer and Delhivery."
              : "The returned item hasn't reached you yet. LoopD2C keeps tracking it, even after the exchange closes, and emails you if it goes back to the customer."}
          </div>
        ) : (
          <div className="mk-alert mk-alert-info">The returned item has reached you.</div>
        )}
      </section>
    );
  }
  if (!eligible) return null;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}/early-replacement`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(shopDomain ? { "x-shopify-shop-domain": shopDomain } : {}), ...(await adminAuthHeaders()) },
        body: JSON.stringify({ reason }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update the exchange.");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the exchange.");
      setBusy(false);
    }
  }

  return (
    <section className="mk-card" style={{ display: "grid", gap: 8 }}>
      <h2 className="mk-section-title">Return delayed by the courier?</h2>
      <p className="mk-help">Delhivery has picked up the return. If it&apos;s taking too long to reach you, you can send the replacement now instead of waiting. The return is still tracked, and you&apos;re emailed if it goes back to the customer.</p>
      {!open ? (
        <div><button type="button" className="mk-btn" onClick={() => setOpen(true)}>Ship replacement before the return arrives</button></div>
      ) : (
        <>
          <label className="mk-field">
            <span className="mk-label">Why now? (kept on the exchange)</span>
            <textarea className="mk-input" rows={2} maxLength={500} placeholder="Return in transit 9 days; customer waiting" value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          {error && <div className="mk-alert mk-alert-error">{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="mk-btn mk-btn-primary" disabled={busy || reason.trim().length < 5} onClick={submit}>{busy ? "Saving…" : "Clear replacement to ship"}</button>
            <button type="button" className="mk-btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="mk-help">Then use &quot;Create replacement shipment&quot; below. The customer gets the &quot;replacement processing&quot; update.</p>
        </>
      )}
    </section>
  );
}
