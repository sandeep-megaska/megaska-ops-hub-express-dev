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

  const fieldClassName = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500";
  const labelClassName = "text-sm font-medium text-slate-700";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">Lifecycle Action Controls</h3>

      <div className="mt-4 grid max-w-xl gap-3">
        <label className={labelClassName}>
          Current Status
          <input value={currentStatus} disabled className={fieldClassName} />
        </label>

        <label className={labelClassName}>
          Next Status
          <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className={fieldClassName}>
            {(allowedTransitions.length ? allowedTransitions : [currentStatus]).map((status) => (
              <option key={status} value={status}>
                {status} ({ACTION_LABELS[status] || status})
              </option>
            ))}
          </select>
        </label>

        {approvingRefund ? (
          <>
            <label className={labelClassName}>
              Refund amount ₹ <span aria-hidden="true">*</span>
              <input
                inputMode="decimal"
                required
                placeholder="500 or 785.95"
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
                className={fieldClassName}
              />
            </label>

            <label className={labelClassName}>
              Refund method override
              <select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value)} className={fieldClassName}>
                <option value="">Auto-detect from payment gateway</option>
                <option value="COD">COD</option>
                <option value="PREPAID">PREPAID</option>
              </select>
            </label>
          </>
        ) : null}

        <button
          type="button"
          onClick={updateStatus}
          disabled={!allowedTransitions.length}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
        >
          {ACTION_LABELS[nextStatus] || "Apply Status"}
        </button>
      </div>

      <hr className="my-5 border-slate-200" />

      <h4 className="text-base font-semibold text-slate-900">Internal Admin Note</h4>

      <div className="mt-3 grid max-w-xl gap-3">
        <label className={labelClassName}>
          Admin Note
          <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} className={`${fieldClassName} min-h-28`} />
        </label>

        <button
          type="button"
          onClick={saveNote}
          className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          Save Note
        </button>
      </div>

      {message ? <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
    </section>
  );
}
