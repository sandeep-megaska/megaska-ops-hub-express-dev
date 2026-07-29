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

    setMessage("Wallet updated successfully. Refresh to view latest ledger.");
  }

  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <h3>Wallet Operations</h3>
      <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
        <label>
          Admin ID (optional)
          <input value={adminId} onChange={(event) => setAdminId(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
      </div>

      <hr style={{ margin: "14px 0" }} />
      <h4>Manual Credit</h4>
      <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
        <input value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} placeholder="Amount (e.g. 499.00)" />
        <select value={creditReason} onChange={(event) => setCreditReason(event.target.value)}>
          <option value="MANUAL_CREDIT">Manual Credit</option>
          <option value="GOODWILL_CREDIT">Goodwill Credit</option>
          <option value="ADJUSTMENT">Adjustment</option>
        </select>
        <textarea value={creditNote} onChange={(event) => setCreditNote(event.target.value)} placeholder="Admin note (required)" />
        <button
          type="button"
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

      <hr style={{ margin: "14px 0" }} />
      <h4>Manual Debit</h4>
      <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
        <input value={debitAmount} onChange={(event) => setDebitAmount(event.target.value)} placeholder="Amount (e.g. 199.00)" />
        <select value={debitReason} onChange={(event) => setDebitReason(event.target.value)}>
          <option value="MANUAL_DEBIT">Manual Debit</option>
          <option value="ADJUSTMENT">Adjustment</option>
        </select>
        <textarea value={debitNote} onChange={(event) => setDebitNote(event.target.value)} placeholder="Admin note (required)" />
        <button
          type="button"
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

      {message ? <p style={{ marginTop: 12 }}>{message}</p> : null}
    </section>
  );
}
