"use client";

import Link from "next/link";
import { useState } from "react";
import { adminAuthHeaders } from "../../../lib/admin-fetch";

type Line = { shopifyLineItemId: string; title: string; variantTitle: string | null; sku: string | null; quantity: number };
type Address = { name: string; phone: string; address1: string; address2: string; city: string; state: string; pin: string; country: string; email: string; source?: string };
type Lookup = {
  order: { orderNumber: string; status: string; deliveredAt: string | null; withinWindow: boolean; paymentGateway: string | null };
  customer: { name: string | null; phone: string | null };
  lines: Line[];
  address: Address | null;
  openRequests: Array<{ id: string; requestType: string; status: string; reverseAwb: string | null }>;
};

const REASONS: Array<{ value: string; label: string }> = [
  { value: "WRONG_ITEM", label: "Wrong item delivered" },
  { value: "DAMAGED_ITEM", label: "Damaged or defective item" },
  { value: "LATE_DELIVERY", label: "Delivered late; customer unavailable" },
  { value: "OTHER", label: "Other" },
];

const ADDRESS_FIELDS: Array<{ key: keyof Address; label: string }> = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "address1", label: "Address line 1" },
  { key: "address2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pin", label: "PIN code" },
];

export default function ArrangeReversePickupForm({ shopDomain, initialOrder }: { shopDomain: string; initialOrder: string }) {
  const [orderNumber, setOrderNumber] = useState(initialOrder);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("WRONG_ITEM");
  const [note, setNote] = useState("");
  const [feeMode, setFeeMode] = useState<"WAIVE" | "PAYMENT_ID">("WAIVE");
  const [paymentId, setPaymentId] = useState("");
  const [editAddress, setEditAddress] = useState(false);
  const [address, setAddress] = useState<Partial<Address>>({});
  const [bookAnyway, setBookAnyway] = useState(false);
  const [windowNote, setWindowNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ requestId: string; awb: string | null } | null>(null);

  async function headers() {
    return { "Content-Type": "application/json", ...(shopDomain ? { "x-shopify-shop-domain": shopDomain } : {}), ...(await adminAuthHeaders()) };
  }

  async function findOrder() {
    setBusy(true);
    setError("");
    setResult(null);
    setLookup(null);
    try {
      const response = await fetch(`/api/admin/reverse-pickups/lookup?order=${encodeURIComponent(orderNumber.trim())}`, { headers: await headers(), cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as Lookup & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not find the order.");
      setLookup(data);
      setQuantities(Object.fromEntries(data.lines.map((line) => [line.shopifyLineItemId, line.quantity])));
      setAddress(data.address ?? {});
      setEditAddress(!data.address);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not find the order.");
    } finally {
      setBusy(false);
    }
  }

  const openExchange = lookup?.openRequests.find((request) => request.requestType === "EXCHANGE") || null;
  const bookedIssue = lookup?.openRequests.find((request) => request.requestType === "ISSUE" && request.reverseAwb) || null;
  const chosen = lookup ? lookup.lines.filter((line) => (quantities[line.shopifyLineItemId] || 0) > 0) : [];
  const ready =
    lookup &&
    !openExchange &&
    !bookedIssue &&
    chosen.length > 0 &&
    (feeMode === "WAIVE" || /^pay_[A-Za-z0-9]{8,40}$/.test(paymentId.trim())) &&
    (reason !== "OTHER" || note.trim().length >= 5) &&
    (lookup.order.withinWindow || (bookAnyway && windowNote.trim().length >= 5));

  async function book() {
    if (!lookup) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/reverse-pickups", {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({
          orderNumber: lookup.order.orderNumber,
          lines: chosen.map((line) => ({ shopifyLineItemId: line.shopifyLineItemId, quantity: quantities[line.shopifyLineItemId] })),
          reason,
          note: note.trim(),
          fee: feeMode === "PAYMENT_ID" ? { mode: "PAYMENT_ID", paymentId: paymentId.trim() } : { mode: "WAIVE" },
          address: editAddress ? address : null,
          allowOutsideWindow: bookAnyway,
          outsideWindowNote: windowNote.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; requestId?: string; booking?: { shipment?: { awb?: string | null } } | null; bookingError?: { message: string } | null };
      if (!response.ok) throw new Error(data.error || "Could not arrange the pickup.");
      if (data.bookingError) {
        setError(`Saved on the issue request, but Delhivery didn't book it: ${data.bookingError.message} Fix it and press Book again.`);
        return;
      }
      setResult({ requestId: data.requestId || "", awb: data.booking?.shipment?.awb ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not arrange the pickup.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <section className="mk-card" style={{ display: "grid", gap: 8 }}>
        <div className="mk-alert mk-alert-success">Reverse pickup booked{result.awb ? ` on Delhivery, AWB ${result.awb}` : ""}. loopd2c tracks it and marks the goods received when they reach you.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="mk-btn" href={`/admin/issues/${result.requestId}`}>Open the issue request</Link>
          <button type="button" className="mk-btn" onClick={() => { setResult(null); setLookup(null); setOrderNumber(""); setNote(""); setPaymentId(""); setBookAnyway(false); setWindowNote(""); }}>Arrange another</button>
        </div>
      </section>
    );
  }

  return (
    <section className="mk-card" style={{ display: "grid", gap: 12 }}>
      <h2 className="mk-section-title">Arrange a reverse pickup</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="mk-field" style={{ minWidth: 220 }}>
          <span className="mk-label">Order number</span>
          <input className="mk-input" placeholder="522404" value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && orderNumber.trim()) findOrder(); }} />
        </label>
        <button type="button" className="mk-btn" disabled={busy || !orderNumber.trim()} onClick={findOrder}>{busy && !lookup ? "Finding…" : "Find order"}</button>
      </div>

      {lookup && (
        <>
          <p className="mk-help">
            Order {lookup.order.orderNumber} · {lookup.customer.name || "Customer"} · {lookup.order.status.toLowerCase().replace(/_/g, " ")}
            {lookup.order.deliveredAt ? ` · delivered ${new Date(lookup.order.deliveredAt).toLocaleDateString("en-IN")}` : " · no delivery date"}
            {lookup.order.paymentGateway ? ` · ${lookup.order.paymentGateway}` : ""}
          </p>

          {openExchange && (
            <div className="mk-alert mk-alert-warning">
              This order has an open exchange. Book its pickup there (&quot;Fee paid another way, or waived&quot;): <Link href={`/admin/exchanges/${openExchange.id}`}>open the exchange</Link>.
            </div>
          )}
          {bookedIssue && (
            <div className="mk-alert mk-alert-info">
              A reverse pickup is already booked for this order (AWB {bookedIssue.reverseAwb}): <Link href={`/admin/issues/${bookedIssue.id}`}>open the issue request</Link>.
            </div>
          )}

          {!openExchange && !bookedIssue && (
            <>
              <div style={{ display: "grid", gap: 6 }}>
                <span className="mk-label">Items to pick up</span>
                {lookup.lines.length === 0 && <div className="mk-alert mk-alert-warning">Couldn&apos;t load this order&apos;s items from Shopify.</div>}
                {lookup.lines.map((line) => (
                  <label key={line.shopifyLineItemId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="number"
                      className="mk-input"
                      style={{ width: 72 }}
                      min={0}
                      max={line.quantity}
                      value={quantities[line.shopifyLineItemId] ?? 0}
                      onChange={(event) => setQuantities({ ...quantities, [line.shopifyLineItemId]: Math.max(0, Math.min(line.quantity, Number(event.target.value) || 0)) })}
                    />
                    <span>of {line.quantity} · {line.title}{line.variantTitle ? ` (${line.variantTitle})` : ""}{line.sku ? ` · ${line.sku}` : ""}</span>
                  </label>
                ))}
              </div>

              <label className="mk-field">
                <span className="mk-label">Reason</span>
                <select className="mk-input" value={reason} onChange={(event) => setReason(event.target.value)}>
                  {REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="mk-field">
                <span className="mk-label">Note for the team{reason === "OTHER" ? " (required)" : " (optional)"}</span>
                <input className="mk-input" placeholder="Customer received MBKS10 Wine instead of Black; WhatsApp 18 Nov" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
              </label>

              <div style={{ display: "grid", gap: 6 }}>
                <span className="mk-label">Pickup fee</span>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="radio" name="fee" checked={feeMode === "WAIVE"} onChange={() => setFeeMode("WAIVE")} /> Megaska pays (wrong or damaged item, our delay)
                </label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="radio" name="fee" checked={feeMode === "PAYMENT_ID"} onChange={() => setFeeMode("PAYMENT_ID")} /> Customer already paid (Razorpay payment ID)
                </label>
                {feeMode === "PAYMENT_ID" && (
                  <input className="mk-input" placeholder="pay_Nx3kQ9rT2vLm8s" value={paymentId} maxLength={60} onChange={(event) => setPaymentId(event.target.value)} />
                )}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <span className="mk-label">Pickup address</span>
                {lookup.address && !editAddress ? (
                  <p className="mk-help">
                    {[lookup.address.name, lookup.address.phone, lookup.address.address1, lookup.address.address2, lookup.address.city, lookup.address.state, lookup.address.pin].filter(Boolean).join(", ")}{" "}
                    <button type="button" className="mk-btn mk-btn-sm" onClick={() => setEditAddress(true)}>Change (customer is elsewhere)</button>
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                    {ADDRESS_FIELDS.map((field) => (
                      <label key={field.key} className="mk-field">
                        <span className="mk-label">{field.label}</span>
                        <input className="mk-input" value={String(address[field.key] ?? "")} maxLength={250} onChange={(event) => setAddress({ ...address, [field.key]: event.target.value })} />
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {!lookup.order.withinWindow && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="mk-alert mk-alert-warning">Delivered more than 7 days ago (or no delivery date).</div>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={bookAnyway} onChange={(event) => setBookAnyway(event.target.checked)} /> Book anyway
                  </label>
                  {bookAnyway && <input className="mk-input" placeholder="Why (e.g. customer was away for Diwali; parcel arrived late)" value={windowNote} maxLength={500} onChange={(event) => setWindowNote(event.target.value)} />}
                </div>
              )}

              {error && <div className="mk-alert mk-alert-error">{error}</div>}
              <div>
                <button type="button" className="mk-btn mk-btn-primary" disabled={busy || !ready} onClick={book}>{busy ? "Booking…" : "Book reverse pickup on Delhivery"}</button>
              </div>
              <p className="mk-help">Saved as an issue request (created by the team) so the return is tracked and you can inspect, replace or refund it from there. Delhivery texts the customer about the pickup.</p>
            </>
          )}
          {(openExchange || bookedIssue) && error && <div className="mk-alert mk-alert-error">{error}</div>}
        </>
      )}
      {!lookup && error && <div className="mk-alert mk-alert-error">{error}</div>}
    </section>
  );
}
