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
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState("");
  const [message, setMessage] = useState("");

  const approvingRefund = nextStatus === "APPROVED";

  function parseRefundAmountPaise() {
    const trimmed = refundAmount.trim();
    if (!trimmed) return { refundAmountPaise: null, error: "Refund amount is required" };
    if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return { refundAmountPaise: null, error: "Refund amount must be numeric with max 2 decimal places" };
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || numeric <= 0) return { refundAmountPaise: null, error: "Refund amount must be greater than 0" };
    return { refundAmountPaise: Math.round(numeric * 100), error: null };
  }

  async function updateStatus() {
    if (!adminKey) {
      setMessage("Admin key is required");
      return;
    }

    const refundAmountResult = approvingRefund ? parseRefundAmountPaise() : { refundAmountPaise: null, error: null };
    if (refundAmountResult.error) {
      setMessage(refundAmountResult.error);
      return;
    }

    const payload: Record<string, string | number | null> = { nextStatus, adminNote };
    if (approvingRefund) {
      payload.refundAmountPaise = refundAmountResult.refundAmountPaise;
      payload.refundAmountMinor = refundAmountResult.refundAmountPaise;
      if (refundMethod) payload.refundMethod = refundMethod;
    }

    const response = await fetch(`/api/admin/issue-requests/${requestId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const serverError = data?.serverError || data?.error || "Failed to update status";
      const validation = data?.validation
        ? [
            data.validation.missingShopContext ? "Missing shop context." : null,
            data.validation.missingRefundAmount ? "Missing refund amount." : null,
            data.validation.paymentMethodUndetermined ? "Payment method could not be determined. Select COD or PREPAID and retry." : null,
            data.validation.missingCustomerProfile ? "Missing customer profile." : null,
            data.validation.invalidRefundAmount ? "Invalid refund amount." : null,
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
        {approvingRefund ? (
          <>
            <label>
              Refund amount ₹ <span aria-hidden="true">*</span>
              <input
                inputMode="decimal"
                required
                placeholder="500 or 785.95"
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
                style={{ display: "block", width: "100%" }}
              />
            </label>
            <label>
              Refund method override
              <select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value)} style={{ display: "block", width: "100%" }}>
                <option value="">Auto-detect from payment gateway</option>
                <option value="COD">COD</option>
                <option value="PREPAID">PREPAID</option>
              </select>
            </label>
          </>
        ) : null}
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
