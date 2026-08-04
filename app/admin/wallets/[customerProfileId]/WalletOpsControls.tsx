"use client";

import { useState } from "react";
import { adminAuthHeaders } from "../../../../lib/admin-fetch";

type Props = {
  customerProfileId: string;
};

export default function WalletOpsControls({ customerProfileId }: Props) {
  const [adminId, setAdminId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("MANUAL_CREDIT");
  const [creditNote, setCreditNote] = useState("");
  const [debitAmount, setDebitAmount] = useState("");
  const [debitReason, setDebitReason] = useState("ADJUSTMENT");
  const [debitNote, setDebitNote] = useState("");
  const [message, setMessage] = useState("");

  async function submitAction(path: string, payload: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await adminAuthHeaders()),
      },
      body: JSON.stringify({ ...payload, adminId }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data?.error || "Request failed");
      return;
    }

    // Surface the gift-card outcome so a silent top-up failure is visible (credit only;
    // debit is ledger-only and returns no giftCard).
    const gc = data?.giftCard as { status?: string; reason?: string } | undefined;
    let giftMsg = "";
    if (gc && typeof gc === "object" && gc.status) {
      if (gc.status === "created") giftMsg = " Gift card created and the code was emailed to the customer.";
      else if (gc.status === "topped_up") giftMsg = " The customer's gift card was topped up.";
      else if (gc.status === "already_synced") giftMsg = "";
      else if (gc.status === "failed") giftMsg = ` ⚠️ But the gift-card top-up FAILED: ${gc.reason || "unknown reason"}. The customer cannot spend this at checkout until it succeeds.`;
      else giftMsg = ` ⚠️ Gift-card sync did not complete (${gc.status}); it needs a retry.`;
    }

    setMessage("Wallet updated successfully." + giftMsg + " Refresh to view the latest ledger.");
  }

  return (
    <section className="mk-card">
      <h3 className="mk-section-title">Wallet Operations</h3>
      <p className="mk-page-subtitle" style={{ marginTop: 0 }}>
        A manual <strong>credit</strong> also tops up the customer&apos;s Shopify gift card, so it is spendable at checkout.
        A manual <strong>debit</strong> adjusts this ledger only — reduce the gift card itself from Shopify&apos;s gift-card admin.
      </p>
      <div className="mk-field" style={{ maxWidth: 560 }}>
        <label className="mk-label" htmlFor="wallet-admin-id">Admin ID (optional)</label>
        <input id="wallet-admin-id" className="mk-input" value={adminId} onChange={(event) => setAdminId(event.target.value)} />
      </div>

      <div className="mk-grid-2" style={{ marginTop: 16 }}>
        <div className="mk-card">
          <h4 className="mk-section-title" style={{ fontSize: 15 }}>Manual Credit</h4>
          <div style={{ display: "grid", gap: 12 }}>
            <div className="mk-field">
              <label className="mk-label" htmlFor="credit-amount">Amount (₹)</label>
              <input id="credit-amount" className="mk-input" value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} placeholder="Amount (e.g. 499.00)" />
            </div>
            <div className="mk-field">
              <label className="mk-label" htmlFor="credit-reason">Reason</label>
              <select id="credit-reason" className="mk-select" value={creditReason} onChange={(event) => setCreditReason(event.target.value)}>
                <option value="MANUAL_CREDIT">Manual Credit</option>
                <option value="GOODWILL_CREDIT">Goodwill Credit</option>
                <option value="ADJUSTMENT">Adjustment</option>
              </select>
            </div>
            <div className="mk-field">
              <label className="mk-label" htmlFor="credit-note">Admin note</label>
              <textarea id="credit-note" className="mk-textarea" value={creditNote} onChange={(event) => setCreditNote(event.target.value)} placeholder="Admin note (required)" />
            </div>
            <button
              type="button"
              className="mk-btn mk-btn-success"
              onClick={() =>
                submitAction(`/api/admin/wallets/${customerProfileId}/credit`, {
                  amount: creditAmount,
                  reason: creditReason,
                  adminNote: creditNote,
                })
              }
            >
              Apply Credit
            </button>
          </div>
        </div>

        <div className="mk-card">
          <h4 className="mk-section-title" style={{ fontSize: 15 }}>Manual Debit</h4>
          <div style={{ display: "grid", gap: 12 }}>
            <div className="mk-field">
              <label className="mk-label" htmlFor="debit-amount">Amount (₹)</label>
              <input id="debit-amount" className="mk-input" value={debitAmount} onChange={(event) => setDebitAmount(event.target.value)} placeholder="Amount (e.g. 199.00)" />
            </div>
            <div className="mk-field">
              <label className="mk-label" htmlFor="debit-reason">Reason</label>
              <select id="debit-reason" className="mk-select" value={debitReason} onChange={(event) => setDebitReason(event.target.value)}>
                <option value="MANUAL_DEBIT">Manual Debit</option>
                <option value="ADJUSTMENT">Adjustment</option>
              </select>
            </div>
            <div className="mk-field">
              <label className="mk-label" htmlFor="debit-note">Admin note</label>
              <textarea id="debit-note" className="mk-textarea" value={debitNote} onChange={(event) => setDebitNote(event.target.value)} placeholder="Admin note (required)" />
            </div>
            <button
              type="button"
              className="mk-btn mk-btn-danger"
              onClick={() =>
                submitAction(`/api/admin/wallets/${customerProfileId}/debit`, {
                  amount: debitAmount,
                  reason: debitReason,
                  adminNote: debitNote,
                })
              }
            >
              Apply Debit
            </button>
          </div>
        </div>
      </div>

      {message ? <div className="mk-alert mk-alert-info" style={{ marginTop: 16 }}>{message}</div> : null}
    </section>
  );
}
