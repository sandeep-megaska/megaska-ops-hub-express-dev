"use client";

import { useState } from "react";

type Props = {
  requestId: string;
  currentStatus: string;
  allowedTransitions: string[];
  currentAdminNote: string;
};

const ACTION_LABELS: Record<string, string> = {
  PICKUP_PENDING: "NEED_MORE_INFO",
  PAYMENT_RECEIVED: "APPROVE_FOR_EXCHANGE",
  APPROVED: "APPROVE_FOR_REFUND",
  REJECTED: "REJECT",
  CLOSED: "CLOSED",
  RETURN_RECEIVED: "Mark Return Received",
  AWAITING_PAYMENT: "UNDER_REVIEW",
  OPEN: "OPEN",
};

export default function IssueLifecycleControls({ requestId, currentStatus, allowedTransitions, currentAdminNote }: Props) {
  const [adminKey, setAdminKey] = useState("");
  const [nextStatus, setNextStatus] = useState(allowedTransitions[0] || currentStatus);
  const [adminNote, setAdminNote] = useState(currentAdminNote);
  const [message, setMessage] = useState("");

  async function updateStatus() {
    if (!adminKey) {
      setMessage("Admin key is required");
      return;
    }

    const response = await fetch(`/api/admin/issue-requests/${requestId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
      },
      body: JSON.stringify({ nextStatus, adminNote }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const serverError = data?.serverError || data?.error || "Failed to update status";
      const validation = data?.validation
        ? [
            data.validation.missingShopContext ? "Missing shop context." : null,
            data.validation.missingRefundAmount ? "Missing refund amount." : null,
            data.validation.paymentMethodUndetermined ? "Payment method could not be determined." : null,
          ]
            .filter(Boolean)
            .join(" ")
        : "";
      setMessage(validation ? `${serverError} ${validation}` : serverError);
      return;
    }

    setMessage(`Status updated to ${data?.request?.status || nextStatus}. Refresh to view latest values.`);
  }

  async function saveNote() {
    if (!adminKey) {
      setMessage("Admin key is required");
      return;
    }

    const response = await fetch(`/api/admin/issue-requests/${requestId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
      },
      body: JSON.stringify({ adminNote }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data?.error || "Failed to save admin note");
      return;
    }

    setMessage(data?.message || "Admin note saved. Refresh to view latest values.");
  }

  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <h3>Lifecycle Action Controls</h3>
      <div style={{ display: "grid", gap: 8, maxWidth: 500 }}>
        <label>
          Admin Key
          <input value={adminKey} onChange={(event) => setAdminKey(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
      </div>
      <div style={{ display: "grid", gap: 8, maxWidth: 500, marginTop: 8 }}>
        <label>
          Current Status
          <input value={currentStatus} disabled style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Next Status
          <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} style={{ display: "block", width: "100%" }}>
            {(allowedTransitions.length ? allowedTransitions : [currentStatus]).map((status) => (
              <option key={status} value={status}>
                {status} ({ACTION_LABELS[status] || status})
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={updateStatus} disabled={!allowedTransitions.length}>{ACTION_LABELS[nextStatus] || "Apply Status"}</button>
      </div>

      <hr style={{ margin: "16px 0" }} />
      <h4>Internal Admin Note</h4>
      <div style={{ display: "grid", gap: 8, maxWidth: 500 }}>
        <label>
          Admin Note
          <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <button type="button" onClick={saveNote}>Save Note</button>
      </div>
      {message ? <p style={{ marginTop: 12 }}>{message}</p> : null}
    </section>
  );
}
