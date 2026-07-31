"use client";

import { useMemo, useState } from "react";
import { adminAuthHeaders } from "../../../../lib/admin-fetch";

type RequestItem = {
  id: string;
  productTitle: string | null;
  variantTitle: string | null;
  currentSize: string | null;
  requestedSize: string | null;
  quantity: number;
  stockReviewNote: string | null;
};

type RequestPayment = {
  id: string;
  purpose: string;
  status: string;
  amount: number;
  currency: string;
  provider: string;
  paymentLinkUrl: string | null;
  paymentId: string | null;
  createdAtIso: string;
  paidAtIso: string | null;
  invoice: { id: string; invoiceNumber: string; invoiceStatus: string; invoiceDateIso: string; totalPaise: number; gstPaise: number } | null;
};

type ReverseShipmentSnapshot = {
  status: string;
  carrier: string | null;
  awb: string | null;
  trackingUrl: string | null;
  pickupAtIso: string | null;
  deliveredAtIso: string | null;
  remarks: string | null;
};

type ForwardShipmentSnapshot = {
  status: string;
  carrier: string | null;
  awb: string | null;
  trackingUrl: string | null;
  shippedAtIso: string | null;
  deliveredAtIso: string | null;
  remarks: string | null;
};

type Props = {
  requestId: string;
  shopDomain: string;
  currentStatus: string;
  allowedTransitions: string[];
  currentAdminNote: string;
  reason: string;
  customerNote: string;
  items: RequestItem[];
  payments: RequestPayment[];
  reverseShipment: ReverseShipmentSnapshot | null;
  forwardShipment: ForwardShipmentSnapshot | null;
  delhiveryCapability: { configured: boolean; reason: string };
};

const SHIPMENT_STATUSES = ["NOT_STARTED", "PENDING", "SCHEDULED", "IN_TRANSIT", "DELIVERED", "FAILED"];


function toDateTimeLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function getStepState(currentStatus: string) {
  const paymentPaid = ["PAYMENT_RECEIVED", "APPROVED", "PICKUP_PENDING", "PICKUP_SCHEDULED", "PICKUP_COMPLETED", "ITEM_RECEIVED", "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "CLOSED"].includes(currentStatus);
  const approved = ["APPROVED", "PICKUP_PENDING", "PICKUP_SCHEDULED", "PICKUP_COMPLETED", "ITEM_RECEIVED", "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "CLOSED"].includes(currentStatus);
  const rejected = currentStatus === "REJECTED";
  const reversePickup = ["PICKUP_PENDING", "PICKUP_SCHEDULED", "PICKUP_COMPLETED", "ITEM_RECEIVED", "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "CLOSED"].includes(currentStatus);
  const selfShip = !reversePickup && !rejected && currentStatus !== "OPEN";
  const itemReceived = ["ITEM_RECEIVED", "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "CLOSED"].includes(currentStatus);
  const replacementShipped = ["REPLACEMENT_SHIPPED", "CLOSED"].includes(currentStatus);
  const completed = currentStatus === "CLOSED";

  return [
    { label: "Requested", done: true, muted: false },
    { label: approved ? "Approved" : rejected ? "Rejected" : "Approved / Rejected", done: approved || rejected, muted: false },
    { label: paymentPaid ? "Paid" : "Payment Pending", done: paymentPaid, muted: rejected },
    { label: reversePickup ? "Reverse Pickup" : selfShip ? "Self Ship" : "Reverse Pickup / Self Ship", done: reversePickup || selfShip, muted: rejected },
    { label: "Item Received", done: itemReceived, muted: rejected },
    { label: "Replacement Shipped", done: replacementShipped, muted: rejected },
    { label: "Completed", done: completed, muted: rejected },
  ];
}

function cardTitleClass() {
  return "mk-section-title";
}

function paymentStatusBadgeClass(status: string) {
  if (status === "PAID") return "mk-badge mk-badge-success";
  if (status === "PENDING") return "mk-badge mk-badge-warning";
  if (status === "FAILED") return "mk-badge mk-badge-danger";
  if (status === "CANCELLED") return "mk-badge mk-badge-neutral";
  return "mk-badge mk-badge-neutral";
}


export default function ExchangeLifecycleControls({
  requestId,
  shopDomain,
  currentStatus,
  allowedTransitions,
  currentAdminNote,
  reason,
  customerNote,
  items,
  payments,
  reverseShipment,
  forwardShipment,
  delhiveryCapability,
}: Props) {
  const [nextStatus, setNextStatus] = useState(allowedTransitions[0] || currentStatus);
  const [adminNote, setAdminNote] = useState(currentAdminNote);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [reversePickupCharge, setReversePickupCharge] = useState("120");
  const [returnMethod, setReturnMethod] = useState<"REVERSE_PICKUP" | "SELF_SHIP">("REVERSE_PICKUP");

  const [reverseShipmentStatus, setReverseShipmentStatus] = useState(reverseShipment?.status || "PENDING");
  const [reverseCarrier, setReverseCarrier] = useState(reverseShipment?.carrier || "");
  const [reverseAwb, setReverseAwb] = useState(reverseShipment?.awb || "");
  const [reverseTrackingUrl, setReverseTrackingUrl] = useState(reverseShipment?.trackingUrl || "");
  const [reversePickupAt, setReversePickupAt] = useState(toDateTimeLocal(reverseShipment?.pickupAtIso));
  const [reverseDeliveredAt, setReverseDeliveredAt] = useState(toDateTimeLocal(reverseShipment?.deliveredAtIso));
  const [reverseRemarks, setReverseRemarks] = useState(reverseShipment?.remarks || "");

  const [forwardShipmentStatus, setForwardShipmentStatus] = useState(forwardShipment?.status || "PENDING");
  const [forwardCarrier, setForwardCarrier] = useState(forwardShipment?.carrier || "");
  const [forwardAwb, setForwardAwb] = useState(forwardShipment?.awb || "");
  const [forwardTrackingUrl, setForwardTrackingUrl] = useState(forwardShipment?.trackingUrl || "");
  const [forwardShippedAt, setForwardShippedAt] = useState(toDateTimeLocal(forwardShipment?.shippedAtIso));
  const [forwardDeliveredAt, setForwardDeliveredAt] = useState(toDateTimeLocal(forwardShipment?.deliveredAtIso));
  const [forwardRemarks, setForwardRemarks] = useState(forwardShipment?.remarks || "");

  const [statusLoading, setStatusLoading] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);
  const [reverseShipmentLoading, setReverseShipmentLoading] = useState(false);
  const [forwardShipmentLoading, setForwardShipmentLoading] = useState(false);
  const [invoiceLoadingId, setInvoiceLoadingId] = useState<string | null>(null);
  const [delhiveryLoading, setDelhiveryLoading] = useState(false);
  const [delhiverySyncLoading, setDelhiverySyncLoading] = useState(false);
  const [delhiveryForwardLoading, setDelhiveryForwardLoading] = useState(false);
  const [delhiveryForwardSyncLoading, setDelhiveryForwardSyncLoading] = useState(false);

  const stepState = useMemo(() => getStepState(currentStatus), [currentStatus]);
  const latestPayment = payments[0] || null;
  const awaitingPayment = currentStatus === "AWAITING_PAYMENT";
  const paymentCompleted = latestPayment?.status === "PAID" || currentStatus === "PAYMENT_RECEIVED";
  const reversePickupRequired = awaitingPayment || currentStatus === "PAYMENT_RECEIVED" || currentStatus === "PICKUP_PENDING" || currentStatus === "PICKUP_SCHEDULED" || currentStatus === "PICKUP_COMPLETED";
  const canCreateReverseShipment = !reversePickupRequired || paymentCompleted;
  const canCreateForwardShipment = ["ITEM_RECEIVED", "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "CLOSED"].includes(currentStatus);
  const canApprove = currentStatus === "OPEN" || currentStatus === "AWAITING_PAYMENT";
  const delhiveryEligibleStatus = ["PAYMENT_RECEIVED", "APPROVED", "PICKUP_PENDING"].includes(currentStatus);
  const canCreateDelhiveryReversePickup = delhiveryCapability.configured && latestPayment?.status === "PAID" && !reverseShipment?.awb && delhiveryEligibleStatus;
  const canSyncDelhiveryReversePickup = Boolean(reverseShipment?.awb && reverseShipment.carrier === "DELHIVERY");
  const canSyncDelhiveryForwardShipment = Boolean(forwardShipment?.awb && forwardShipment.carrier === "DELHIVERY");
  const canCreateDelhiveryForwardShipment = delhiveryCapability.configured
    && ["ITEM_RECEIVED", "REPLACEMENT_PROCESSING"].includes(currentStatus)
    && !forwardShipment?.awb;


  function setError(text: string) {
    setMessage({ type: "error", text });
  }

  function setSuccess(text: string) {
    setMessage({ type: "success", text });
  }

  async function getHeaders() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (shopDomain) {
      headers["x-shopify-shop-domain"] = shopDomain;
    }

    return { ...headers, ...(await adminAuthHeaders()) };
  }

  function ensureAdminContext() {
    if (!shopDomain) {
      setError("Shop domain is missing in this admin session.");
      return false;
    }

    return true;
  }

  async function updateStatus() {
    if (!ensureAdminContext()) return;
    setStatusLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}/status`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({
          nextStatus,
          adminNote,
          approvalMode: nextStatus === "APPROVED" || nextStatus === "AWAITING_PAYMENT" ? "APPROVE" : undefined,
          returnMethod,
          pickupChargeInr: Number(reversePickupCharge || "120"),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to update status");
      }

      setSuccess(`Status updated to ${data?.request?.status || nextStatus}. Refresh to view latest values.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to update status");
    } finally {
      setStatusLoading(false);
    }
  }

  async function saveNote() {
    if (!ensureAdminContext()) return;
    setNoteLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({ adminNote }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to save admin note");
      }

      setSuccess(data?.message || "Admin note saved. Refresh to view latest values.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to save admin note");
    } finally {
      setNoteLoading(false);
    }
  }

  async function saveReverseShipment() {
    if (!ensureAdminContext()) return;
    setReverseShipmentLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}/shipment`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({
          direction: "REVERSE_PICKUP",
          status: reverseShipmentStatus,
          carrier: reverseCarrier,
          awb: reverseAwb,
          trackingUrl: reverseTrackingUrl,
          pickupAt: reversePickupAt || null,
          deliveredAt: reverseDeliveredAt || null,
          remarks: reverseRemarks,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to update reverse shipment");
      }

      setSuccess(`Reverse pickup shipment updated (${data?.shipment?.status || reverseShipmentStatus}).`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to update reverse shipment");
    } finally {
      setReverseShipmentLoading(false);
    }
  }

  async function saveForwardShipment() {
    if (!ensureAdminContext()) return;
    setForwardShipmentLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}/shipment`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({
          direction: "FORWARD_REPLACEMENT",
          status: forwardShipmentStatus,
          carrier: forwardCarrier,
          awb: forwardAwb,
          trackingUrl: forwardTrackingUrl,
          shippedAt: forwardShippedAt || null,
          deliveredAt: forwardDeliveredAt || null,
          remarks: forwardRemarks,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to update replacement shipment");
      }

      setSuccess(`Replacement shipment updated (${data?.shipment?.status || forwardShipmentStatus}).`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to update replacement shipment");
    } finally {
      setForwardShipmentLoading(false);
    }
  }
  async function createDelhiveryReversePickup() {
    if (!ensureAdminContext()) return;
    setDelhiveryLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}/delhivery/reverse-pickup`, {
        method: "POST",
        headers: await getHeaders(),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to create Delhivery reverse pickup");
      }

      const shipment = data?.shipment;
      if (shipment?.awb) {
        setReverseCarrier(shipment.carrier || "DELHIVERY");
        setReverseAwb(shipment.awb || "");
        setReverseTrackingUrl(shipment.trackingUrl || "");
        setReverseShipmentStatus(shipment.status || "SCHEDULED");
      }

      setSuccess(data?.idempotent
        ? "Existing Delhivery reverse pickup found. Refresh to view latest shipment."
        : "Delhivery reverse pickup created. Refresh to view latest shipment and status.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create Delhivery reverse pickup");
    } finally {
      setDelhiveryLoading(false);
    }
  }


  async function syncDelhiveryReversePickupTracking() {
    if (!ensureAdminContext()) return;
    setDelhiverySyncLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}/delhivery/reverse-pickup/sync`, {
        method: "POST",
        headers: await getHeaders(),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to sync Delhivery reverse pickup tracking");
      }

      const shipment = data?.shipment;
      if (shipment) {
        setReverseCarrier(shipment.carrier || "DELHIVERY");
        setReverseAwb(shipment.awb || "");
        setReverseTrackingUrl(shipment.trackingUrl || "");
        setReverseShipmentStatus(shipment.status || "PENDING");
        setReverseDeliveredAt(toDateTimeLocal(shipment.deliveredAt));
        setReverseRemarks(shipment.remarks || "");
      }

      setSuccess(`Delhivery tracking synced (${shipment?.status || "updated"}). Refresh to view latest request status.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to sync Delhivery reverse pickup tracking");
    } finally {
      setDelhiverySyncLoading(false);
    }
  }


  async function createDelhiveryForwardShipment() {
    if (!ensureAdminContext()) return;
    setDelhiveryForwardLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}/delhivery/forward-shipment`, {
        method: "POST",
        headers: await getHeaders(),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to create Delhivery replacement shipment");
      }

      const shipment = data?.shipment;
      if (shipment?.awb) {
        setForwardCarrier(shipment.carrier || "DELHIVERY");
        setForwardAwb(shipment.awb || "");
        setForwardTrackingUrl(shipment.trackingUrl || "");
        setForwardShipmentStatus(shipment.status || "IN_TRANSIT");
        setForwardShippedAt(toDateTimeLocal(shipment.shippedAt));
        setForwardRemarks(shipment.remarks || "");
      }

      setSuccess(data?.idempotent
        ? "Existing Delhivery replacement shipment found. Refresh to view latest shipment."
        : "Delhivery replacement shipment created. Refresh to view latest shipment and status.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create Delhivery replacement shipment");
    } finally {
      setDelhiveryForwardLoading(false);
    }
  }


  async function syncDelhiveryForwardShipmentTracking() {
    if (!ensureAdminContext()) return;
    setDelhiveryForwardSyncLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}/delhivery/forward-shipment/sync`, {
        method: "POST",
        headers: await getHeaders(),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to sync Delhivery replacement tracking");
      }

      const shipment = data?.shipment;
      if (shipment) {
        setForwardCarrier(shipment.carrier || "DELHIVERY");
        setForwardAwb(shipment.awb || "");
        setForwardTrackingUrl(shipment.trackingUrl || "");
        setForwardShipmentStatus(shipment.status || "PENDING");
        setForwardShippedAt(toDateTimeLocal(shipment.shippedAt));
        setForwardDeliveredAt(toDateTimeLocal(shipment.deliveredAt));
        setForwardRemarks(shipment.remarks || "");
      }

      setSuccess(`Delhivery replacement tracking synced (${shipment?.status || "updated"}). Refresh to view latest request status.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to sync Delhivery replacement tracking");
    } finally {
      setDelhiveryForwardSyncLoading(false);
    }
  }


  return (
    <div className="mk-page">
      <section className="mk-card">
        <h2 className={cardTitleClass()}>Workflow progress</h2>
        <div className="mk-grid-4" style={{ marginTop: 16 }}>
          {stepState.map((step) => (
            <span
              key={step.label}
              className={`mk-badge ${step.done ? "mk-badge-success" : step.muted ? "mk-badge-neutral" : "mk-badge-warning"}`}
              style={{ justifyContent: "center" }}
            >
              {step.label}
            </span>
          ))}
        </div>
      </section>

      <section className="mk-card">
        <h2 className={cardTitleClass()}>Request details</h2>
        <div className="mk-list" style={{ marginTop: 16 }}>
          {items.map((item) => (
            <article key={item.id} className="mk-card">
              <div className="mk-grid-4">
                <div><p className="mk-stat-label">Product</p><p style={{ fontWeight: 600 }}>{item.productTitle || "—"}</p></div>
                <div><p className="mk-stat-label">Variant</p><p style={{ fontWeight: 600 }}>{item.variantTitle || "—"}</p></div>
                <div><p className="mk-stat-label">Current size</p><p style={{ fontWeight: 600 }}>{item.currentSize || "—"}</p></div>
                <div><p className="mk-stat-label">Requested size</p><p style={{ fontWeight: 600 }}>{item.requestedSize || "—"}</p></div>
                <div><p className="mk-stat-label">Quantity</p><p style={{ fontWeight: 600 }}>{item.quantity}</p></div>
                <div><p className="mk-stat-label">Customer reason</p><p style={{ fontWeight: 600 }}>{reason || "—"}</p></div>
                <div><p className="mk-stat-label">Customer note</p><p style={{ fontWeight: 600 }}>{customerNote || "—"}</p></div>
                <div><p className="mk-stat-label">Stock review note</p><p style={{ fontWeight: 600 }}>{item.stockReviewNote || "—"}</p></div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-card">
        <h2 className={cardTitleClass()}>Ops review</h2>
        <div className="mk-grid-2" style={{ marginTop: 16 }}>
          <div className="mk-field">
            <label className="mk-label">Admin note</label>
            <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} className="mk-textarea" placeholder="Ops review notes" />
          </div>
          <div className="mk-page" style={{ gap: 16 }}>
            <div className="mk-field">
              <label className="mk-label">Current status</label>
              <input value={currentStatus} disabled className="mk-input" />
            </div>
            <div className="mk-field">
              <label className="mk-label">Available next status</label>
              <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="mk-select">
                {(allowedTransitions.length ? allowedTransitions : [currentStatus]).map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div className="mk-header-actions">
              <button type="button" onClick={saveNote} disabled={noteLoading} className="mk-btn">
                {noteLoading ? "Saving note..." : "Save admin note"}
              </button>
              <button type="button" onClick={updateStatus} disabled={!allowedTransitions.length || statusLoading || (!canApprove && (nextStatus === "APPROVED" || nextStatus === "AWAITING_PAYMENT"))} className="mk-btn mk-btn-primary">
                {statusLoading ? "Applying..." : "Apply status"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-card">
        <h2 className={cardTitleClass()}>Return method</h2>
        <div className="mk-grid-2" style={{ marginTop: 16 }}>
          <div className="mk-field">
            <label className="mk-label">Return mode</label>
            <select value={returnMethod} onChange={(event) => setReturnMethod(event.target.value as "REVERSE_PICKUP" | "SELF_SHIP")} className="mk-select">
              <option value="REVERSE_PICKUP">Reverse pickup</option>
              <option value="SELF_SHIP">Self ship</option>
            </select>
          </div>
          <div className="mk-field">
            <label className="mk-label">Reverse pickup charge (₹)</label>
            <input type="number" min="0" step="1" value={reversePickupCharge} onChange={(event) => setReversePickupCharge(event.target.value)} className="mk-input" />
          </div>
        </div>
        <p className="mk-help" style={{ marginTop: 8 }}>Configured charge is used for payment-link generation if backend supports dynamic amount. Current saved amount: ₹{reversePickupCharge || "120"}.</p>

        <div className="mk-grid-3" style={{ marginTop: 16 }}>
          <div className="mk-field"><label className="mk-label">Shipment status</label><select value={reverseShipmentStatus} onChange={(event) => setReverseShipmentStatus(event.target.value)} className="mk-select">{SHIPMENT_STATUSES.map((status) => (<option key={status} value={status}>{status}</option>))}</select></div>
          <div className="mk-field"><label className="mk-label">Carrier</label><input value={reverseCarrier} onChange={(event) => setReverseCarrier(event.target.value)} className="mk-input" /></div>
          <div className="mk-field"><label className="mk-label">AWB</label><input value={reverseAwb} onChange={(event) => setReverseAwb(event.target.value)} className="mk-input" /></div>
          <div className="mk-field"><label className="mk-label">Tracking URL</label><input value={reverseTrackingUrl} onChange={(event) => setReverseTrackingUrl(event.target.value)} className="mk-input" /></div>
          <div className="mk-field"><label className="mk-label">Pickup date</label><input type="datetime-local" value={reversePickupAt} onChange={(event) => setReversePickupAt(event.target.value)} className="mk-input" /></div>
          <div className="mk-field"><label className="mk-label">Delivered/received date</label><input type="datetime-local" value={reverseDeliveredAt} onChange={(event) => setReverseDeliveredAt(event.target.value)} className="mk-input" /></div>
          <div className="mk-field" style={{ gridColumn: "1 / -1" }}><label className="mk-label">Remarks</label><textarea value={reverseRemarks} onChange={(event) => setReverseRemarks(event.target.value)} className="mk-textarea" /></div>
        </div>
        <button type="button" onClick={saveReverseShipment} disabled={reverseShipmentLoading || !canCreateReverseShipment} className="mk-btn mk-btn-primary" style={{ marginTop: 16 }}>
          {reverseShipmentLoading ? "Saving reverse shipment..." : "Save reverse shipment"}
        </button>
        {!canCreateReverseShipment ? (
          <p className="mk-help" style={{ marginTop: 8, color: "var(--warning-text)" }}>Reverse pickup actions are locked until reverse pickup payment is completed.</p>
        ) : null}
      </section>

      <section className="mk-card">
        <h2 className={cardTitleClass()}>Payment + GST</h2>
        <p className="mk-section-subtitle">Payment records</p>
        {payments.length === 0 ? (
          <p className="mk-help">No payment records found yet.</p>
        ) : (
          <div className="mk-table-wrap">
            <table className="mk-table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>Provider</th>
                  <th>Payment Link</th>
                  <th>Payment ID</th>
                  <th>Created At</th>
                  <th>Paid At</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td style={{ fontWeight: 600 }}>₹{payment.amount}</td>
                    <td>{payment.purpose}</td>
                    <td>
                      <span className={paymentStatusBadgeClass(payment.status)}>
                        {payment.status}
                      </span>
                    </td>
                    <td>{payment.provider}</td>
                    <td style={{ maxWidth: 256, wordBreak: "break-all" }}>
                      {payment.paymentLinkUrl ? (
                        <a href={payment.paymentLinkUrl} target="_blank" rel="noreferrer" className="mk-link">
                          Open payment link
                        </a>
                      ) : (
                        <span className="mk-help">Payment link will be generated after approval</span>
                      )}
                    </td>
                    <td>{payment.paymentId || "—"}</td>
                    <td>{formatDate(payment.createdAtIso)}</td>
                    <td>{formatDate(payment.paidAtIso)}</td>
                    <td>{payment.invoice ? payment.invoice.invoiceNumber : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mk-alert mk-alert-info" style={{ marginTop: 16 }}>
          {latestPayment?.status === "PAID"
            ? "Payment received via Razorpay"
            : latestPayment?.status === "PENDING"
              ? "Customer can pay via dashboard"
              : "Customer can pay via dashboard"}
        </div>

        <div className="mk-card" style={{ marginTop: 20, background: "var(--panel-2)" }}>
          <h3 className="mk-section-title">GST invoice</h3>
          <div className="mk-page" style={{ gap: 6, marginTop: 8 }}>
            {latestPayment?.invoice ? (
              <>
                <p className="mk-help">Invoice status: {latestPayment.invoice.invoiceStatus}</p>
                <p className="mk-help">Invoice number: {latestPayment.invoice.invoiceNumber}</p>
                <p className="mk-help">GST amount: ₹{(latestPayment.invoice.gstPaise / 100).toFixed(2)}</p>
              </>
            ) : (
              <p className="mk-help">{latestPayment?.status === "PAID" ? "Ready to generate invoice." : "Invoice will be available after payment is completed."}</p>
            )}
          </div>
          <div className="mk-header-actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={async()=>{ if(!ensureAdminContext()) return; setInvoiceLoadingId("generate"); const r=await fetch(`/api/admin/exchange-requests/${requestId}/invoice`,{method:"POST",headers:await getHeaders(),body:JSON.stringify({action:"generate"})}); setInvoiceLoadingId(null); if(r.ok){setSuccess("Invoice generated. Refresh to view latest values.")} else {const d=await r.json().catch(()=>({})); setError(d?.error||"Failed");}}} disabled={latestPayment?.status!=="PAID" || Boolean(latestPayment?.invoice) || invoiceLoadingId!==null} className="mk-btn mk-btn-sm">{invoiceLoadingId==="generate"?"Generating...":"Generate GST Invoice"}</button>
            <button type="button" onClick={async()=>{ if(!ensureAdminContext()) return; setInvoiceLoadingId("send"); const r=await fetch(`/api/admin/exchange-requests/${requestId}/invoice`,{method:"POST",headers:await getHeaders(),body:JSON.stringify({action:"send"})}); setInvoiceLoadingId(null); if(r.ok){setSuccess("Invoice email sent.")} else {const d=await r.json().catch(()=>({})); setError(d?.error||"Failed");}}} disabled={latestPayment?.status!=="PAID" || invoiceLoadingId!==null} className="mk-btn mk-btn-sm">{invoiceLoadingId==="send"?"Sending...":"Send Invoice Email"}</button>
          </div>
        </div>
      </section>

      <section className="mk-card">
        <h2 className={cardTitleClass()}>Replacement shipment</h2>
        <div className="mk-grid-3" style={{ marginTop: 16 }}>
          <div className="mk-field"><label className="mk-label">Shipment status</label><select value={forwardShipmentStatus} onChange={(event) => setForwardShipmentStatus(event.target.value)} className="mk-select">{SHIPMENT_STATUSES.map((status) => (<option key={status} value={status}>{status}</option>))}</select></div>
          <div className="mk-field"><label className="mk-label">Carrier</label><input value={forwardCarrier} onChange={(event) => setForwardCarrier(event.target.value)} className="mk-input" /></div>
          <div className="mk-field"><label className="mk-label">AWB</label><input value={forwardAwb} onChange={(event) => setForwardAwb(event.target.value)} className="mk-input" /></div>
          <div className="mk-field"><label className="mk-label">Tracking URL</label><input value={forwardTrackingUrl} onChange={(event) => setForwardTrackingUrl(event.target.value)} className="mk-input" /></div>
          <div className="mk-field"><label className="mk-label">Shipped date</label><input type="datetime-local" value={forwardShippedAt} onChange={(event) => setForwardShippedAt(event.target.value)} className="mk-input" /></div>
          <div className="mk-field"><label className="mk-label">Delivered date</label><input type="datetime-local" value={forwardDeliveredAt} onChange={(event) => setForwardDeliveredAt(event.target.value)} className="mk-input" /></div>
          <div className="mk-field" style={{ gridColumn: "1 / -1" }}><label className="mk-label">Remarks</label><textarea value={forwardRemarks} onChange={(event) => setForwardRemarks(event.target.value)} className="mk-textarea" /></div>
        </div>
        <button type="button" onClick={saveForwardShipment} disabled={forwardShipmentLoading || !canCreateForwardShipment} className="mk-btn mk-btn-primary" style={{ marginTop: 16 }}>
          {forwardShipmentLoading ? "Saving replacement shipment..." : "Save replacement shipment"}
        </button>
        {!canCreateForwardShipment ? (
          <p className="mk-help" style={{ marginTop: 8, color: "var(--warning-text)" }}>Replacement shipment actions unlock only after returned item is received.</p>
        ) : null}
      </section>

      <section className="mk-card">
        <h2 className={cardTitleClass()}>Delhivery automation</h2>
        <p className="mk-section-subtitle" style={{ marginTop: 8 }}>
          {delhiveryCapability.configured
            ? "Delhivery credentials detected. Reverse pickup and manual replacement shipment actions are available only at eligible lifecycle steps."
            : delhiveryCapability.reason}
        </p>
        <div className="mk-header-actions" style={{ marginTop: 12 }}>
          <button type="button" onClick={createDelhiveryReversePickup} disabled={!canCreateDelhiveryReversePickup || delhiveryLoading} className="mk-btn mk-btn-sm">{delhiveryLoading ? "Creating reverse pickup..." : "Create reverse pickup"}</button>
          <button type="button" onClick={syncDelhiveryReversePickupTracking} disabled={!canSyncDelhiveryReversePickup || delhiverySyncLoading} className="mk-btn mk-btn-sm">{delhiverySyncLoading ? "Syncing tracking..." : "Sync reverse pickup tracking"}</button>
          <button type="button" onClick={createDelhiveryForwardShipment} disabled={!canCreateDelhiveryForwardShipment || delhiveryForwardLoading} className="mk-btn mk-btn-sm">{delhiveryForwardLoading ? "Creating replacement shipment..." : "Create replacement shipment"}</button>
          <button type="button" onClick={syncDelhiveryForwardShipmentTracking} disabled={!canSyncDelhiveryForwardShipment || delhiveryForwardSyncLoading} className="mk-btn mk-btn-sm">{delhiveryForwardSyncLoading ? "Syncing replacement tracking..." : "Sync replacement tracking"}</button>
        </div>
        {!canCreateDelhiveryReversePickup ? (
          <p className="mk-help" style={{ marginTop: 8 }}>Reverse pickup create requires Delhivery config, paid reverse pickup fee, eligible status, and no existing AWB. Replacement create requires ITEM_RECEIVED/REPLACEMENT_PROCESSING and no forward AWB. Sync requires a Delhivery AWB for the matching reverse or replacement shipment.</p>
        ) : null}
      </section>

      {message ? (
        <div className={`mk-alert ${message.type === "success" ? "mk-alert-success" : "mk-alert-error"}`}>
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
