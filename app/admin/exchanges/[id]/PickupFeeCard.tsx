"use client";

import { useState } from "react";
import { adminAuthHeaders } from "../../../../lib/admin-fetch";

type Props = {
  requestId: string;
  shopDomain: string;
  /** Shown only while the reverse pickup isn't booked and the exchange can still get one. */
  show: boolean;
  feePaid: boolean;
  feeStatus: string | null;
  feeRupees: number;
  withinWindow: boolean;
  delhiveryConfigured: boolean;
};

type Result = { feeOutcome?: string; booking?: { shipment?: { awb?: string | null } } | null; bookingError?: { message: string } | null; error?: string };

// For when the customer didn't pay through loopd2c's link: the link expired and
// the team sent a new one from Razorpay (the webhook can't see that payment), or
// the fee is waived. Records the fee, then books the Delhivery reverse pickup.
export default function PickupFeeCard({ requestId, shopDomain, show, feePaid, feeStatus, feeRupees, withinWindow, delhiveryConfigured }: Props) {
  const [mode, setMode] = useState<"PAYMENT_ID" | "WAIVE">("PAYMENT_ID");
  const [paymentId, setPaymentId] = useState("");
  const [note, setNote] = useState("");
  const [bookAnyway, setBookAnyway] = useState(false);
  const [windowNote, setWindowNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  if (!show) return null;

  const needsWindowNote = !withinWindow;
  const ready =
    delhiveryConfigured &&
    (feePaid || (mode === "PAYMENT_ID" ? /^pay_[A-Za-z0-9]{8,40}$/.test(paymentId.trim()) : note.trim().length >= 5)) &&
    (!needsWindowNote || (bookAnyway && windowNote.trim().length >= 5));

  async function submit() {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}/reverse-pickup-fee`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(shopDomain ? { "x-shopify-shop-domain": shopDomain } : {}), ...(await adminAuthHeaders()) },
        body: JSON.stringify({ mode, paymentId: paymentId.trim(), note: note.trim(), allowOutsideWindow: bookAnyway, outsideWindowNote: windowNote.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as Result;
      if (!response.ok) throw new Error(data.error || "Could not record the fee.");
      if (data.bookingError) {
        setError(`${data.feeOutcome === "ALREADY_PAID" ? "" : "Fee recorded. "}The pickup wasn't booked: ${data.bookingError.message}`);
        setBusy(false);
        return;
      }
      setDone(`Reverse pickup booked${data.booking?.shipment?.awb ? `, AWB ${data.booking.shipment.awb}` : ""}. Refreshing…`);
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the fee.");
      setBusy(false);
    }
  }

  return (
    <section className="mk-card" style={{ display: "grid", gap: 10 }}>
      <h2 className="mk-section-title">Fee paid another way, or waived</h2>
      <p className="mk-help">
        {feePaid
          ? "The pickup fee is paid but the reverse pickup isn't booked yet."
          : `The ₹${feeRupees} pickup fee shows ${feeStatus ? feeStatus.toLowerCase().replace(/_/g, " ") : "not paid"}. If the customer paid through a link you created in Razorpay, enter its payment ID: loopd2c checks it with Razorpay and books the Delhivery pickup. Or waive the fee.`}
      </p>
      {!delhiveryConfigured && <div className="mk-alert mk-alert-warning">Delhivery isn&apos;t set up for this shop (Settings → Delhivery).</div>}

      {!feePaid && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" name="fee-mode" checked={mode === "PAYMENT_ID"} onChange={() => setMode("PAYMENT_ID")} /> Customer paid (Razorpay payment ID)
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" name="fee-mode" checked={mode === "WAIVE"} onChange={() => setMode("WAIVE")} /> Waive the fee
            </label>
          </div>
          {mode === "PAYMENT_ID" ? (
            <label className="mk-field">
              <span className="mk-label">Razorpay payment ID (Razorpay → Payments, starts with pay_)</span>
              <input className="mk-input" placeholder="pay_Nx3kQ9rT2vLm8s" value={paymentId} maxLength={60} onChange={(event) => setPaymentId(event.target.value)} />
            </label>
          ) : (
            <label className="mk-field">
              <span className="mk-label">Why waive it? (kept on the exchange)</span>
              <input className="mk-input" placeholder="Goodwill: delivery was 6 days late" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
            </label>
          )}
        </>
      )}

      {needsWindowNote && (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="mk-alert mk-alert-warning">This order was delivered more than 7 days ago (or has no delivery date).</div>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={bookAnyway} onChange={(event) => setBookAnyway(event.target.checked)} /> Book anyway
          </label>
          {bookAnyway && (
            <input className="mk-input" placeholder="Why (e.g. payment link expired; customer paid on day 9)" value={windowNote} maxLength={500} onChange={(event) => setWindowNote(event.target.value)} />
          )}
        </div>
      )}

      {error && <div className="mk-alert mk-alert-error">{error}</div>}
      {done && <div className="mk-alert mk-alert-success">{done}</div>}
      <div>
        <button type="button" className="mk-btn mk-btn-primary" disabled={busy || !ready} onClick={submit}>
          {busy ? "Working…" : feePaid ? "Book reverse pickup" : mode === "PAYMENT_ID" ? "Verify payment & book pickup" : "Waive fee & book pickup"}
        </button>
      </div>
    </section>
  );
}
