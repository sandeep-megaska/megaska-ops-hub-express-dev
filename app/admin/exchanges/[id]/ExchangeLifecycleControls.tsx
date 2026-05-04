"use client";

import { useMemo, useState } from "react";

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
  return "text-base font-semibold text-slate-900";
}

function paymentStatusBadgeClass(status: string) {
  if (status === "PAID") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "PENDING") return "bg-amber-100 text-amber-700 border-amber-200";
  if (status === "FAILED") return "bg-red-100 text-red-700 border-red-200";
  if (status === "CANCELLED") return "bg-slate-200 text-slate-700 border-slate-300";
  return "bg-slate-100 text-slate-700 border-slate-200";
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
  const [adminKey, setAdminKey] = useState("");
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

  const stepState = useMemo(() => getStepState(currentStatus), [currentStatus]);
  const latestPayment = payments[0] || null;
  const awaitingPayment = currentStatus === "AWAITING_PAYMENT";
  const paymentCompleted = latestPayment?.status === "PAID" || currentStatus === "PAYMENT_RECEIVED";
  const reversePickupRequired = awaitingPayment || currentStatus === "PAYMENT_RECEIVED" || currentStatus === "PICKUP_PENDING" || currentStatus === "PICKUP_SCHEDULED" || currentStatus === "PICKUP_COMPLETED";
  const canCreateReverseShipment = !reversePickupRequired || paymentCompleted;
  const canCreateForwardShipment = ["ITEM_RECEIVED", "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "CLOSED"].includes(currentStatus);
  const canApprove = currentStatus === "OPEN" || currentStatus === "AWAITING_PAYMENT";


  function setError(text: string) {
    setMessage({ type: "error", text });
  }

  function setSuccess(text: string) {
    setMessage({ type: "success", text });
  }

  function getHeaders() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-admin-key": adminKey,
    };

    if (shopDomain) {
      headers["x-shopify-shop-domain"] = shopDomain;
    }

    return headers;
  }

  function ensureAdminContext() {
    if (!adminKey.trim()) {
      setError("Admin key is required.");
      return false;
    }

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
        headers: getHeaders(),
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
        headers: getHeaders(),
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
        headers: getHeaders(),
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
        headers: getHeaders(),
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



  return (
    <div className="grid gap-6">
      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className={cardTitleClass()}>Workflow progress</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {stepState.map((step) => (
            <div
              key={step.label}
              className={`rounded-lg border px-3 py-2 text-sm ${step.done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : step.muted ? "border-slate-200 bg-slate-50 text-slate-400" : "border-amber-200 bg-amber-50 text-amber-700"}`}
            >
              {step.label}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className={cardTitleClass()}>Request details</h2>
        <div className="mt-4 grid gap-4">
          {items.map((item) => (
            <article key={item.id} className="rounded-lg border border-slate-200 p-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div><p className="text-slate-500">Product</p><p className="font-medium">{item.productTitle || "—"}</p></div>
                <div><p className="text-slate-500">Variant</p><p className="font-medium">{item.variantTitle || "—"}</p></div>
                <div><p className="text-slate-500">Current size</p><p className="font-medium">{item.currentSize || "—"}</p></div>
                <div><p className="text-slate-500">Requested size</p><p className="font-medium">{item.requestedSize || "—"}</p></div>
                <div><p className="text-slate-500">Quantity</p><p className="font-medium">{item.quantity}</p></div>
                <div className="md:col-span-2"><p className="text-slate-500">Customer reason</p><p className="font-medium">{reason || "—"}</p></div>
                <div className="md:col-span-2"><p className="text-slate-500">Customer note</p><p className="font-medium">{customerNote || "—"}</p></div>
                <div className="md:col-span-2"><p className="text-slate-500">Stock review note</p><p className="font-medium">{item.stockReviewNote || "—"}</p></div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className={cardTitleClass()}>Ops review</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Admin key</span>
            <input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} className="w-full rounded-lg border px-3 py-2" placeholder="ADMIN_OPS_KEY" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Shop domain</span>
            <input value={shopDomain} disabled className="w-full rounded-lg border bg-slate-50 px-3 py-2 text-slate-500" />
          </label>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Admin note</span>
            <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} className="min-h-24 w-full rounded-lg border px-3 py-2" placeholder="Ops review notes" />
          </label>
          <div className="grid gap-4">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Current status</span>
              <input value={currentStatus} disabled className="w-full rounded-lg border bg-slate-50 px-3 py-2 text-slate-500" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Available next status</span>
              <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="w-full rounded-lg border px-3 py-2">
                {(allowedTransitions.length ? allowedTransitions : [currentStatus]).map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={saveNote} disabled={noteLoading} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
                {noteLoading ? "Saving note..." : "Save admin note"}
              </button>
              <button type="button" onClick={updateStatus} disabled={!allowedTransitions.length || statusLoading || (!canApprove && (nextStatus === "APPROVED" || nextStatus === "AWAITING_PAYMENT"))} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                {statusLoading ? "Applying..." : "Apply status"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className={cardTitleClass()}>Return method</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Return mode</span>
            <select value={returnMethod} onChange={(event) => setReturnMethod(event.target.value as "REVERSE_PICKUP" | "SELF_SHIP")} className="w-full rounded-lg border px-3 py-2">
              <option value="REVERSE_PICKUP">Reverse pickup</option>
              <option value="SELF_SHIP">Self ship</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Reverse pickup charge (₹)</span>
            <input type="number" min="0" step="1" value={reversePickupCharge} onChange={(event) => setReversePickupCharge(event.target.value)} className="w-full rounded-lg border px-3 py-2" />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">Configured charge is used for payment-link generation if backend supports dynamic amount. Current saved amount: ₹{reversePickupCharge || "120"}.</p>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm"><span className="mb-1 block text-slate-600">Shipment status</span><select value={reverseShipmentStatus} onChange={(event) => setReverseShipmentStatus(event.target.value)} className="w-full rounded-lg border px-3 py-2">{SHIPMENT_STATUSES.map((status) => (<option key={status} value={status}>{status}</option>))}</select></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">Carrier</span><input value={reverseCarrier} onChange={(event) => setReverseCarrier(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">AWB</span><input value={reverseAwb} onChange={(event) => setReverseAwb(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">Tracking URL</span><input value={reverseTrackingUrl} onChange={(event) => setReverseTrackingUrl(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">Pickup date</span><input type="datetime-local" value={reversePickupAt} onChange={(event) => setReversePickupAt(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">Delivered/received date</span><input type="datetime-local" value={reverseDeliveredAt} onChange={(event) => setReverseDeliveredAt(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm md:col-span-2 xl:col-span-3"><span className="mb-1 block text-slate-600">Remarks</span><textarea value={reverseRemarks} onChange={(event) => setReverseRemarks(event.target.value)} className="min-h-20 w-full rounded-lg border px-3 py-2" /></label>
        </div>
        <button type="button" onClick={saveReverseShipment} disabled={reverseShipmentLoading || !canCreateReverseShipment} className="mt-4 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
          {reverseShipmentLoading ? "Saving reverse shipment..." : "Save reverse shipment"}
        </button>
        {!canCreateReverseShipment ? (
          <p className="mt-2 text-xs text-amber-700">Reverse pickup actions are locked until reverse pickup payment is completed.</p>
        ) : null}
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className={cardTitleClass()}>Payment + GST</h2>
        <div className="mt-4 rounded-lg border border-slate-200">
          <div className="border-b bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">Payment records</div>
          <div className="overflow-x-auto p-4 text-sm">
            {payments.length === 0 ? (
              <p className="text-slate-500">No payment records found yet.</p>
            ) : (
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">Amount</th>
                    <th className="px-2 py-2">Purpose</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Provider</th>
                    <th className="px-2 py-2">Payment Link</th>
                    <th className="px-2 py-2">Payment ID</th>
                    <th className="px-2 py-2">Created At</th>
                    <th className="px-2 py-2">Paid At</th>
                    <th className="px-2 py-2">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b align-top">
                      <td className="px-2 py-2 font-medium text-slate-900">₹{payment.amount}</td>
                      <td className="px-2 py-2">{payment.purpose}</td>
                      <td className="px-2 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${paymentStatusBadgeClass(payment.status)}`}>
                          {payment.status}
                        </span>
                      </td>
                      <td className="px-2 py-2">{payment.provider}</td>
                      <td className="max-w-64 break-all px-2 py-2">
                        {payment.paymentLinkUrl ? (
                          <a href={payment.paymentLinkUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
                            Open payment link
                          </a>
                        ) : (
                          <span className="text-slate-500">Payment link will be generated after approval</span>
                        )}
                      </td>
                      <td className="px-2 py-2">{payment.paymentId || "—"}</td>
                      <td className="px-2 py-2">{formatDate(payment.createdAtIso)}</td>
                      <td className="px-2 py-2">{formatDate(payment.paidAtIso)}</td>
                      <td className="px-2 py-2">{payment.invoice ? payment.invoice.invoiceNumber : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-700">
          {latestPayment?.status === "PAID"
            ? "Payment received via Razorpay"
            : latestPayment?.status === "PENDING"
              ? "Customer can pay via dashboard"
              : "Customer can pay via dashboard"}
        </div>

        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">GST invoice</h3>
          <div className="mt-2 grid gap-2 text-sm text-slate-600">
            {latestPayment?.invoice ? (
              <>
                <p>Invoice status: {latestPayment.invoice.invoiceStatus}</p>
                <p>Invoice number: {latestPayment.invoice.invoiceNumber}</p>
                <p>GST amount: ₹{(latestPayment.invoice.gstPaise / 100).toFixed(2)}</p>
              </>
            ) : (
              <p>{latestPayment?.status === "PAID" ? "Ready to generate invoice." : "Invoice will be available after payment is completed."}</p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={async()=>{ if(!ensureAdminContext()) return; setInvoiceLoadingId("generate"); const r=await fetch(`/api/admin/exchange-requests/${requestId}/invoice`,{method:"POST",headers:getHeaders(),body:JSON.stringify({action:"generate"})}); setInvoiceLoadingId(null); if(r.ok){setSuccess("Invoice generated. Refresh to view latest values.")} else {const d=await r.json().catch(()=>({})); setError(d?.error||"Failed");}}} disabled={latestPayment?.status!=="PAID" || Boolean(latestPayment?.invoice) || invoiceLoadingId!==null} className="rounded-lg border px-3 py-2 text-xs">{invoiceLoadingId==="generate"?"Generating...":"Generate GST Invoice"}</button>
            <button type="button" onClick={async()=>{ if(!ensureAdminContext()) return; setInvoiceLoadingId("send"); const r=await fetch(`/api/admin/exchange-requests/${requestId}/invoice`,{method:"POST",headers:getHeaders(),body:JSON.stringify({action:"send"})}); setInvoiceLoadingId(null); if(r.ok){setSuccess("Invoice email sent.")} else {const d=await r.json().catch(()=>({})); setError(d?.error||"Failed");}}} disabled={latestPayment?.status!=="PAID" || invoiceLoadingId!==null} className="rounded-lg border px-3 py-2 text-xs">{invoiceLoadingId==="send"?"Sending...":"Send Invoice Email"}</button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className={cardTitleClass()}>Replacement shipment</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm"><span className="mb-1 block text-slate-600">Shipment status</span><select value={forwardShipmentStatus} onChange={(event) => setForwardShipmentStatus(event.target.value)} className="w-full rounded-lg border px-3 py-2">{SHIPMENT_STATUSES.map((status) => (<option key={status} value={status}>{status}</option>))}</select></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">Carrier</span><input value={forwardCarrier} onChange={(event) => setForwardCarrier(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">AWB</span><input value={forwardAwb} onChange={(event) => setForwardAwb(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">Tracking URL</span><input value={forwardTrackingUrl} onChange={(event) => setForwardTrackingUrl(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">Shipped date</span><input type="datetime-local" value={forwardShippedAt} onChange={(event) => setForwardShippedAt(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">Delivered date</span><input type="datetime-local" value={forwardDeliveredAt} onChange={(event) => setForwardDeliveredAt(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm md:col-span-2 xl:col-span-3"><span className="mb-1 block text-slate-600">Remarks</span><textarea value={forwardRemarks} onChange={(event) => setForwardRemarks(event.target.value)} className="min-h-20 w-full rounded-lg border px-3 py-2" /></label>
        </div>
        <button type="button" onClick={saveForwardShipment} disabled={forwardShipmentLoading || !canCreateForwardShipment} className="mt-4 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
          {forwardShipmentLoading ? "Saving replacement shipment..." : "Save replacement shipment"}
        </button>
        {!canCreateForwardShipment ? (
          <p className="mt-2 text-xs text-amber-700">Replacement shipment actions unlock only after returned item is received.</p>
        ) : null}
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className={cardTitleClass()}>Delhivery automation</h2>
        <p className="mt-2 text-sm text-slate-600">
          {delhiveryCapability.configured
            ? "Delhivery credentials detected. API wiring can be connected in next pass."
            : delhiveryCapability.reason}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled className="cursor-not-allowed rounded-lg border px-3 py-2 text-xs text-slate-500">Create reverse pickup (Coming next)</button>
          <button type="button" disabled className="cursor-not-allowed rounded-lg border px-3 py-2 text-xs text-slate-500">Generate manifest/slip (Coming next)</button>
          <button type="button" disabled className="cursor-not-allowed rounded-lg border px-3 py-2 text-xs text-slate-500">Create replacement shipment (Coming next)</button>
        </div>
      </section>


      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className={cardTitleClass()}>Completion</h2>
        <p className="mt-2 text-sm text-slate-600">
          Completion actions are controlled strictly by backend lifecycle transitions.
        </p>
        <div className="mt-3 rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
          Allowed transitions from <span className="font-semibold">{currentStatus}</span>: {allowedTransitions.length ? allowedTransitions.join(", ") : "None (terminal)"}
        </div>
      </section>

      {message ? (
        <div className={`rounded-xl border p-4 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
