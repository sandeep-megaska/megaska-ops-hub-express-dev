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

export default function IssueLifecycleControls({
  requestId,
  currentStatus,
  allowedTransitions,
  currentAdminNote,
  shopDomain,
}: Props) {
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

  async function getHeaders() {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (shopDomain) headers["x-shopify-shop-domain"] = shopDomain;
    return { ...headers, ...(await adminAuthHeaders()) };
  }

  async function updateStatus() {
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
      headers: await getHeaders(),
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
          ].filter(Boolean).join(" ")
        : "";
      setMessage(validation ? `${serverError} ${validation}` : serverError);
      return;
    }

    setMessage(`Status updated to ${data?.request?.status || nextStatus}. Refresh to view latest values.`);
  }

  async function saveNote() {
    const response = await fetch(`/api/admin/issue-requests/${requestId}`, {
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

  return (
    <section className="mk-card">
      <h3 className="mk-section-title">Lifecycle Action Controls</h3>

      <div className="mk-page" style={{ gap: 16, maxWidth: 576, marginTop: 16 }}>
        <div className="mk-field">
          <label className="mk-label">Current Status</label>
          <input value={currentStatus} disabled className="mk-input" />
        </div>

        <div className="mk-field">
          <label className="mk-label">Next Status</label>
          <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="mk-select">
            {(allowedTransitions.length ? allowedTransitions : [currentStatus]).map((status) => (
              <option key={status} value={status}>
                {status} ({ACTION_LABELS[status] || status})
              </option>
            ))}
          </select>
        </div>

        {approvingRefund ? (
          <>
            <div className="mk-field">
              <label className="mk-label">Refund amount ₹ <span aria-hidden="true">*</span></label>
              <input
                inputMode="decimal"
                required
                placeholder="500 or 785.95"
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
                className="mk-input"
              />
            </div>

            <div className="mk-field">
              <label className="mk-label">Refund method override</label>
              <select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value)} className="mk-select">
                <option value="">Auto-detect from payment gateway</option>
                <option value="COD">COD</option>
                <option value="PREPAID">PREPAID</option>
              </select>
            </div>
          </>
        ) : null}

        <div>
          <button
            type="button"
            onClick={updateStatus}
            disabled={!allowedTransitions.length}
            className={`mk-btn ${nextStatus === "REJECTED" ? "mk-btn-danger" : "mk-btn-primary"}`}
          >
            {ACTION_LABELS[nextStatus] || "Apply Status"}
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
