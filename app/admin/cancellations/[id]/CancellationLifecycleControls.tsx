"use client";

import { useState } from "react";
import { adminAuthHeaders } from "../../../../lib/admin-fetch";

type Props = {
  requestId: string;
  currentStatus: string;
  allowedTransitions: string[];
  currentAdminNote: string;
  shopDomain?: string;
};

export default function CancellationLifecycleControls({
  requestId,
  currentStatus,
  allowedTransitions,
  currentAdminNote,
  shopDomain,
}: Props) {
  const [nextStatus, setNextStatus] = useState(allowedTransitions[0] || currentStatus);
  const [adminNote, setAdminNote] = useState(currentAdminNote);
  const [message, setMessage] = useState("");

  async function getHeaders() {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (shopDomain) headers["x-shopify-shop-domain"] = shopDomain;
    return { ...headers, ...(await adminAuthHeaders()) };
  }

  async function updateStatus() {
    const response = await fetch(`/api/admin/cancellation-requests/${requestId}/status`, {
      method: "PATCH",
      headers: await getHeaders(),
      body: JSON.stringify({ nextStatus, adminNote }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data?.error || "Failed to update status");
      return;
    }

    setMessage(`Status updated to ${data?.request?.status || nextStatus}. Refresh to view latest values.`);
  }

  async function saveNote() {
    const response = await fetch(`/api/admin/cancellation-requests/${requestId}`, {
      method: "PATCH",
      headers: await getHeaders(),
      body: JSON.stringify({ adminNote }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data?.error || "Failed to save admin note");
      return;
    }

    setMessage(data?.message || "Admin note saved. Refresh to view latest values.");
  }

  const currentStatusNormalized = currentStatus.toUpperCase();
  const lifecycleSteps = [
    { key: "REQUESTED", label: "Requested", active: ["OPEN", "APPROVED", "REJECTED", "CLOSED"].includes(currentStatusNormalized) },
    { key: "DECISION", label: currentStatusNormalized === "REJECTED" ? "Rejected" : "Approved/Rejected", active: ["APPROVED", "REJECTED", "CLOSED"].includes(currentStatusNormalized) },
    { key: "REFUND_REVIEW", label: "Refund Review", active: ["APPROVED", "CLOSED"].includes(currentStatusNormalized) },
    { key: "CLOSED", label: "Closed", active: currentStatusNormalized === "CLOSED" },
  ];

  return (
    <section className="mk-card">
      <h3 className="mk-section-title">Lifecycle Action Controls</h3>
      <div className="mk-grid-4" style={{ marginTop: 16 }}>
        {lifecycleSteps.map((step, index) => (
          <span
            key={step.key}
            className={`mk-badge ${step.active ? "mk-badge-info" : "mk-badge-neutral"}`}
            style={{ justifyContent: "flex-start" }}
          >
            {index + 1}. {step.label}
          </span>
        ))}
      </div>

      <div className="mk-page" style={{ gap: 16, maxWidth: 576, marginTop: 16 }}>
        <div className="mk-field">
          <label className="mk-label">Current Status</label>
          <input value={currentStatus} disabled className="mk-input" />
        </div>

        <div className="mk-field">
          <label className="mk-label">Next Status</label>
          <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="mk-select">
            {(allowedTransitions.length ? allowedTransitions : [currentStatus]).map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>

        <div>
          <button
            type="button"
            onClick={updateStatus}
            disabled={!allowedTransitions.length}
            className="mk-btn mk-btn-primary"
          >
            Apply Status
          </button>
        </div>
      </div>

      <hr style={{ margin: "20px 0", border: "none", borderTop: "1px solid var(--line)" }} />
      <h4 className="mk-section-title">Internal Admin Note</h4>

      <div className="mk-page" style={{ gap: 16, maxWidth: 576, marginTop: 12 }}>
        <div className="mk-field">
          <label className="mk-label">Admin Note</label>
          <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} className="mk-textarea" />
        </div>
        <div>
          <button
            type="button"
            onClick={saveNote}
            className="mk-btn"
          >
            Save Note
          </button>
        </div>
      </div>
      {message ? <p className="mk-alert mk-alert-info" style={{ marginTop: 12 }}>{message}</p> : null}
    </section>
  );
}
