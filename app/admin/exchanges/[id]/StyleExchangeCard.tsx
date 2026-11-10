"use client";

import { useState } from "react";
import { adminAuthHeaders } from "../../../../lib/admin-fetch";

type Item = {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  requestedSize: string;
  quantity: number;
  replacementTitle: string | null;
  replacementSku: string | null;
  replacementUnitPricePaise: number | null;
  originalUnitPricePaise: number | null;
};
type Variant = { variantId: string; title: string; sku: string; unitPricePaise: number; available: number | null };
type Props = {
  requestId: string;
  shopDomain: string;
  items: Item[];
  differencePaise: number | null;
  settlement: string | null;
  settledAtIso: string | null;
  payment: { status: string; url: string | null; amount: number } | null;
  locked: string | null;
};

const SETTLEMENT_LABEL: Record<string, string> = {
  COLLECT: "Customer pays the difference",
  STORE_CREDIT: "Store credit",
  NO_REFUND: "No refund (customer agreed)",
  MANUAL_REFUND: "Refunded by us outside LoopD2C",
};
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Different-style exchange (team-only): swap an item for another product and settle
// the price difference. Dearer → payment link; cheaper → team chooses.
export default function StyleExchangeCard({ requestId, shopDomain, items, differencePaise, settlement, settledAtIso, payment, locked }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Variant[]>([]);
  const [choice, setChoice] = useState("STORE_CREDIT");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function headers() {
    return { "Content-Type": "application/json", ...(shopDomain ? { "x-shopify-shop-domain": shopDomain } : {}), ...(await adminAuthHeaders()) };
  }
  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/exchange-requests/${requestId}/style`, { method: "POST", headers: await headers(), body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update the exchange.");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the exchange.");
      setBusy(false);
    }
  }
  async function search() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/collabs/variants?q=${encodeURIComponent(query)}`, { headers: await headers() });
      const data = (await response.json().catch(() => ({}))) as { variants?: Variant[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Search failed.");
      setResults(data.variants || []);
      if (!data.variants?.length) setError("No products match. Try the SKU or another word from the title.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  const owed = differencePaise ?? 0;
  return (
    <section className="mk-card" style={{ display: "grid", gap: 10 }}>
      <div>
        <h2 className="mk-section-title">Exchange for a different style</h2>
        <p className="mk-help">When the customer wants another product instead of another size. Prices come from Shopify: what they paid for the item (after discounts) and the new style&apos;s current price.</p>
      </div>
      {error && <div className="mk-alert mk-alert-error">{error}</div>}
      {items.map((item) => (
        <div key={item.id} style={{ display: "grid", gap: 6, borderTop: "1px solid #eaecf0", paddingTop: 8 }}>
          <div>
            <strong>{item.quantity} × {item.productTitle}</strong>{item.variantTitle ? ` (${item.variantTitle})` : ""}
            {item.replacementTitle ? (
              <div className="mk-help">→ <strong>{item.replacementTitle}</strong>{item.replacementSku ? ` · ${item.replacementSku}` : ""} · paid {rupees(item.originalUnitPricePaise ?? 0)}, new {rupees(item.replacementUnitPricePaise ?? 0)}</div>
            ) : (
              <div className="mk-help">→ same product, size {item.requestedSize}</div>
            )}
          </div>
          {!locked && editing !== item.id && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="mk-btn mk-btn-sm" disabled={busy} onClick={() => { setEditing(item.id); setResults([]); setQuery(""); }}>{item.replacementTitle ? "Choose another style" : "Change to a different style"}</button>
              {item.replacementTitle && <button type="button" className="mk-btn mk-btn-sm" disabled={busy} onClick={() => call({ action: "set", itemId: item.id, variantId: null })}>Back to same product</button>}
            </div>
          )}
          {editing === item.id && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input className="mk-input" placeholder="Title or SKU" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); search(); } }} />
                <button type="button" className="mk-btn mk-btn-sm" disabled={busy || query.trim().length < 2} onClick={search}>Search</button>
                <button type="button" className="mk-btn mk-btn-sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              </div>
              {results.map((variant) => (
                <div key={variant.variantId} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span>{variant.title} <span className="mk-help">{variant.sku || "no SKU"} · {rupees(variant.unitPricePaise)} · {variant.available === null ? "stock not tracked" : `${variant.available} in stock`}</span></span>
                  <button type="button" className="mk-btn mk-btn-sm mk-btn-primary" disabled={busy} onClick={() => call({ action: "set", itemId: item.id, variantId: variant.variantId })}>Use this</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {differencePaise !== null && (
        <div style={{ borderTop: "1px solid #eaecf0", paddingTop: 8, display: "grid", gap: 6 }}>
          <strong>{owed > 0 ? `Customer owes ${rupees(owed)}` : owed < 0 ? `Store owes ${rupees(-owed)}` : "Same price: nothing to settle"}</strong>
          {settledAtIso ? (
            <div className="mk-alert mk-alert-info">Settled: {SETTLEMENT_LABEL[settlement || ""] || settlement} ({new Date(settledAtIso).toLocaleString("en-IN")}).</div>
          ) : owed > 0 ? (
            payment && payment.status !== "CANCELLED" ? (
              <div className="mk-help">
                Payment link {payment.status === "PAID" ? "paid" : "sent (Razorpay texts and emails it to the customer)"}{payment.url ? <>: <a className="mk-link" href={payment.url} target="_blank" rel="noreferrer">{payment.url}</a></> : null}. You can also paste it in the WhatsApp chat. The replacement can be booked once it&apos;s paid.
              </div>
            ) : (
              <div><button type="button" className="mk-btn mk-btn-primary" disabled={busy || Boolean(locked)} onClick={() => call({ action: "settle", settlement: "COLLECT" })}>Send payment link for {rupees(owed)}</button></div>
            )
          ) : owed < 0 ? (
            <div style={{ display: "grid", gap: 6 }}>
              <select className="mk-select" value={choice} onChange={(event) => setChoice(event.target.value)}>
                <option value="STORE_CREDIT">Give {rupees(-owed)} as store credit</option>
                <option value="NO_REFUND">No refund (customer agreed)</option>
                <option value="MANUAL_REFUND">We refunded it outside LoopD2C</option>
              </select>
              <input className="mk-input" placeholder="Note (optional)" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
              <div><button type="button" className="mk-btn mk-btn-primary" disabled={busy || Boolean(locked)} onClick={() => call({ action: "settle", settlement: choice, note })}>Settle difference</button></div>
            </div>
          ) : null}
        </div>
      )}
      {locked && <p className="mk-help">{locked}</p>}
    </section>
  );
}
