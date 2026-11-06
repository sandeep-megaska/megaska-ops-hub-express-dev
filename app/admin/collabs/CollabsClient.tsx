"use client";

import { useCallback, useEffect, useState } from "react";
import { adminAuthHeaders } from "../../../lib/admin-fetch";

const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];
const PURPOSES = [["INFLUENCER", "Influencer"], ["COLLAB", "Brand collab"], ["PR", "PR / media"], ["VENDOR_SAMPLE", "Sample to vendor / manufacturer"], ["INTERNAL", "Photoshoot / internal"], ["GIFT", "Gift"], ["OTHER", "Other"]] as const;
const CONTENT_PURPOSES = ["INFLUENCER", "COLLAB", "PR"];
const PURPOSE_LABEL: Record<string, string> = Object.fromEntries(PURPOSES);
const CONTENT = [["PENDING", "Waiting for content"], ["POSTED", "Posted"], ["NOT_POSTED", "Not posted"], ["NOT_NEEDED", "No content expected"]] as const;
const TRACKING: Record<string, [string, string]> = {
  ORDER_CONFIRMED: ["Booked", "mk-badge-neutral"], READY_FOR_PICKUP: ["Awaiting pickup", "mk-badge-neutral"], PICKED_UP: ["Picked up", "mk-badge-info"],
  IN_TRANSIT: ["In transit", "mk-badge-info"], OUT_FOR_DELIVERY: ["Out for delivery", "mk-badge-info"], DELIVERED: ["Delivered", "mk-badge-success"],
  DELIVERY_FAILED: ["Delivery failed", "mk-badge-danger"], RTO_INITIATED: ["Returning to you", "mk-badge-warning"], RTO_DELIVERED: ["Returned to you", "mk-badge-warning"],
  CANCELLED: ["Cancelled", "mk-badge-danger"],
};

type Variant = { variantId: string; title: string; sku: string; unitPricePaise: number; unitCostPaise: number | null; available: number | null };
type Line = Variant & { quantity: number };
type Item = { title: string; sku: string; quantity: number };
type Address = { company?: string; city?: string };
type Row = {
  id: string; createdAt: string; purpose: string; recipientName: string; recipientPhone: string; recipientHandle: string | null; platform: string | null;
  campaign: string | null; address: Address | null; items: Item[]; retailValuePaise: number; productCostPaise: number; shippingCostPaise: number | null; status: string; errorMessage: string | null;
  shopifyOrderName: string | null; awb: string | null; trackingUrl: string | null; trackingStatus: string | null; deliverableStatus: string; contentUrl: string | null;
};
type Summary = { parcels: number; retailValuePaise: number; productCostPaise: number; shippingCostPaise: number; delivered: number; posted: number; expectingPost: number };

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const thisMonth = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
const emptyForm = { purpose: "INFLUENCER", company: "", recipientName: "", recipientPhone: "", recipientEmail: "", recipientHandle: "", platform: "Instagram", campaign: "", notes: "", address1: "", address2: "", city: "", state: "", pin: "", weightGrams: "500", notifyRecipient: false };

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = { ...(await adminAuthHeaders()), ...(init.body ? { "Content-Type": "application/json" } : {}) };
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `Request failed (${response.status}).`);
  return data as T;
}

export default function CollabsClient() {
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async (target: string) => {
    try {
      const data = await api<{ rows: Row[]; summary: Summary }>(`/api/admin/collabs?month=${target}`);
      setRows(data.rows);
      setSummary(data.summary);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load parcels.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ rows: Row[]; summary: Summary }>(`/api/admin/collabs?month=${month}`)
      .then((data) => { if (!cancelled) { setRows(data.rows); setSummary(data.summary); setError(""); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load parcels."); });
    return () => { cancelled = true; };
  }, [month]);

  async function exportCsv() {
    try {
      const response = await fetch(`/api/admin/collabs/export?month=${month}`, { headers: await adminAuthHeaders() });
      if (!response.ok) throw new Error("Export failed.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `collab-parcels-${month}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div className="mk-alert mk-alert-error">{error}</div>}
      {notice && <div className="mk-alert mk-alert-info">{notice}</div>}

      <section className="mk-card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div className="mk-field">
            <label className="mk-label" htmlFor="collab-month">Month</label>
            <input id="collab-month" type="month" className="mk-input" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="mk-btn" onClick={exportCsv}>Export CSV for accounts</button>
            <button type="button" className="mk-btn mk-btn-primary" onClick={() => setShowForm((open) => !open)}>{showForm ? "Close" : "New parcel"}</button>
          </div>
        </div>
        {summary && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Stat label="Parcels sent" value={String(summary.parcels)} hint={`${summary.delivered} delivered`} />
            <Stat label="Retail value" value={rupees(summary.retailValuePaise)} hint="at selling price" />
            <Stat label="Product cost" value={rupees(summary.productCostPaise)} hint="Shopify cost price" />
            <Stat label="Shipping cost" value={rupees(summary.shippingCostPaise)} hint="as entered from the Delhivery bill" />
            <Stat label="Content posted" value={`${summary.posted} of ${summary.expectingPost}`} hint="where content is expected" />
          </div>
        )}
      </section>

      {showForm && <NewParcel onCreated={(message) => { setShowForm(false); setNotice(message); load(month); }} />}

      <section className="mk-card" style={{ display: "grid", gap: 8 }}>
        <h2 className="mk-section-title">Parcels</h2>
        {rows.length === 0 ? (
          <div className="mk-empty"><p className="mk-empty-title">No parcels this month.</p></div>
        ) : (
          <div className="mk-table-wrap">
            <table className="mk-table">
              <thead><tr><th>Sent to</th><th>Items</th><th>Value / cost</th><th>Delivery</th><th>Content</th></tr></thead>
              <tbody>{rows.map((row) => <ParcelRow key={row.id} row={row} onChange={() => load(month)} onError={setError} />)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span className="mk-help">{label}</span>
      <strong style={{ fontSize: 20 }}>{value}</strong>
      <span className="mk-help">{hint}</span>
    </div>
  );
}

function ParcelRow({ row, onChange, onError }: { row: Row; onChange: () => void; onError: (message: string) => void }) {
  const [content, setContent] = useState(row.deliverableStatus);
  const [contentUrl, setContentUrl] = useState(row.contentUrl || "");
  const [shipping, setShipping] = useState(row.shippingCostPaise === null ? "" : String(row.shippingCostPaise / 100));
  const [busy, setBusy] = useState(false);
  const tracking = row.trackingStatus ? TRACKING[row.trackingStatus] || [row.trackingStatus, "mk-badge-neutral"] : null;
  const dirty = content !== row.deliverableStatus || contentUrl !== (row.contentUrl || "") || shipping !== (row.shippingCostPaise === null ? "" : String(row.shippingCostPaise / 100));

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    try {
      await task();
      onChange();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update the parcel.");
    } finally {
      setBusy(false);
    }
  }

  const save = () => run(() => api(`/api/admin/collabs/${row.id}`, { method: "PATCH", body: JSON.stringify({ deliverableStatus: content, contentUrl, shippingCostRupees: shipping }) }));
  const action = (name: "book" | "track") => run(() => api(`/api/admin/collabs/${row.id}`, { method: "POST", body: JSON.stringify({ action: name }) }));

  return (
    <tr>
      <td>
        <strong>{row.recipientName}</strong>
        <div className="mk-help">{[row.address?.company, row.recipientHandle, row.platform].filter(Boolean).join(" · ") || row.recipientPhone}</div>
        <div className="mk-help">{PURPOSE_LABEL[row.purpose] || row.purpose}{row.campaign ? ` · ${row.campaign}` : ""} · {new Date(row.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}{row.shopifyOrderName ? ` · ${row.shopifyOrderName}` : ""}</div>
      </td>
      <td>{row.items.map((item) => <div key={`${item.sku}-${item.title}`} className="mk-help">{item.quantity} × {item.title}</div>)}</td>
      <td>
        <div>{rupees(row.retailValuePaise)}</div>
        <div className="mk-help">cost {rupees(row.productCostPaise)}</div>
        <label className="mk-help" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          Shipping ₹<input className="mk-input" style={{ width: 80 }} inputMode="decimal" aria-label="Shipping cost in rupees" value={shipping} onChange={(event) => setShipping(event.target.value.replace(/[^\d.]/g, ""))} />
        </label>
      </td>
      <td>
        {row.status === "FAILED" ? <span className="mk-badge mk-badge-danger">Not created</span> : tracking ? <span className={`mk-badge ${tracking[1]}`}>{tracking[0]}</span> : <span className="mk-badge mk-badge-warning">Not booked</span>}
        {row.awb && <div className="mk-help">{row.trackingUrl ? <a className="mk-link" href={row.trackingUrl} target="_blank" rel="noreferrer">{row.awb}</a> : row.awb}</div>}
        {row.errorMessage && !row.awb && <div className="mk-help" style={{ color: "#b42318" }}>{row.errorMessage}</div>}
        {row.status === "ORDER_CREATED" && !row.awb && <button type="button" className="mk-btn" disabled={busy} onClick={() => action("book")}>Book on Delhivery</button>}
        {row.awb && row.trackingStatus !== "DELIVERED" && <button type="button" className="mk-link" style={{ background: "none", border: 0, padding: 0 }} disabled={busy} onClick={() => action("track")}>Refresh</button>}
      </td>
      <td style={{ minWidth: 200 }}>
        {!CONTENT_PURPOSES.includes(row.purpose) && content === "NOT_NEEDED" ? <span className="mk-help">No content expected</span> : <>
        <select className="mk-select" aria-label="Content status" value={content} onChange={(event) => setContent(event.target.value)}>
          {CONTENT.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {content === "POSTED" && <input className="mk-input" placeholder="Link to the post" aria-label="Link to the post" value={contentUrl} onChange={(event) => setContentUrl(event.target.value)} style={{ marginTop: 4 }} />}
        {row.contentUrl && content === "POSTED" && !dirty && <div className="mk-help"><a className="mk-link" href={row.contentUrl} target="_blank" rel="noreferrer">Open post</a></div>}
        </>}
        {dirty && <button type="button" className="mk-btn mk-btn-primary" style={{ marginTop: 4 }} disabled={busy} onClick={save}>Save</button>}
      </td>
    </tr>
  );
}

function NewParcel({ onCreated }: { onCreated: (message: string) => void }) {
  const [form, setForm] = useState(emptyForm);
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Variant[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof emptyForm) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const content = CONTENT_PURPOSES.includes(form.purpose);
  const retail = lines.reduce((sum, line) => sum + line.unitPricePaise * line.quantity, 0);
  const cost = lines.reduce((sum, line) => sum + (line.unitCostPaise ?? 0) * line.quantity, 0);

  async function search() {
    setSearching(true);
    try {
      const data = await api<{ variants: Variant[] }>(`/api/admin/collabs/variants?q=${encodeURIComponent(query)}`);
      setResults(data.variants);
      if (!data.variants.length) setError("No products match. Try the SKU or another word from the title.");
      else setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  function add(variant: Variant) {
    setLines((current) => current.some((line) => line.variantId === variant.variantId)
      ? current.map((line) => line.variantId === variant.variantId ? { ...line, quantity: line.quantity + 1 } : line)
      : [...current, { ...variant, quantity: 1 }]);
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const result = await api<{ warnings: string[]; booking: { ok: boolean; awb?: string; error?: string } }>("/api/admin/collabs", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          recipientHandle: content ? form.recipientHandle : "",
          platform: content ? form.platform : "",
          address: { company: form.purpose === "INFLUENCER" ? "" : form.company, address1: form.address1, address2: form.address2, city: form.city, state: form.state, pin: form.pin },
          items: lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
        }),
      });
      const booked = result.booking.ok ? `Booked on Delhivery, AWB ${result.booking.awb}.` : `Shopify order created, but not booked on Delhivery: ${result.booking.error} Use "Book on Delhivery" once fixed.`;
      onCreated([booked, ...result.warnings].join(" "));
      setForm(emptyForm);
      setLines([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the parcel.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mk-card" style={{ display: "grid", gap: 12 }}>
      <h2 className="mk-section-title">New parcel</h2>
      <p className="mk-section-subtitle">Creates a ₹0 Shopify order (100% discount, tagged &quot;LoopD2C Collab&quot;) so stock goes down, then books it on Delhivery as Prepaid. Product and shipping are paid by you.</p>
      {error && <div className="mk-alert mk-alert-error">{error}</div>}
      <div className="mk-form-grid">
        <Field label="For"><select className="mk-select" value={form.purpose} onChange={set("purpose")}>{PURPOSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label={content ? "Campaign (optional)" : "Reference (optional)"}><input className="mk-input" placeholder={content ? "Diwali launch" : "PO / style no."} value={form.campaign} onChange={set("campaign")} /></Field>
        {form.purpose !== "INFLUENCER" && <Field label="Company (optional)"><input className="mk-input" value={form.company} onChange={set("company")} /></Field>}
        <Field label="Name"><input className="mk-input" value={form.recipientName} onChange={set("recipientName")} autoComplete="off" /></Field>
        <Field label="Mobile (for the courier)"><input className="mk-input" inputMode="tel" value={form.recipientPhone} onChange={set("recipientPhone")} /></Field>
        {content && <Field label="Handle (optional)"><input className="mk-input" placeholder="@handle" value={form.recipientHandle} onChange={set("recipientHandle")} /></Field>}
        {content && <Field label="Platform"><select className="mk-select" value={form.platform} onChange={set("platform")}>{["Instagram", "YouTube", "Facebook", "Blog", "Other"].map((name) => <option key={name}>{name}</option>)}</select></Field>}
        <Field label="Email (optional)"><input className="mk-input" type="email" value={form.recipientEmail} onChange={set("recipientEmail")} /></Field>
        <Field label="Address"><input className="mk-input" value={form.address1} onChange={set("address1")} /></Field>
        <Field label="Landmark / area (optional)"><input className="mk-input" value={form.address2} onChange={set("address2")} /></Field>
        <Field label="City"><input className="mk-input" value={form.city} onChange={set("city")} /></Field>
        <Field label="State"><select className="mk-select" value={form.state} onChange={set("state")}><option value="">Choose…</option>{STATES.map((state) => <option key={state}>{state}</option>)}</select></Field>
        <Field label="Pincode"><input className="mk-input" inputMode="numeric" maxLength={6} value={form.pin} onChange={set("pin")} /></Field>
        <Field label="Weight (g)"><input className="mk-input" inputMode="numeric" value={form.weightGrams} onChange={set("weightGrams")} /></Field>
        <Field label="Notes (optional)"><input className="mk-input" placeholder={content ? "1 reel + 2 stories" : "What it's for"} value={form.notes} onChange={set("notes")} /></Field>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="Add products (title or SKU)"><input className="mk-input" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); search(); } }} /></Field>
        <button type="button" className="mk-btn" disabled={searching || query.trim().length < 2} onClick={search}>{searching ? "Searching…" : "Search"}</button>
      </div>
      {results.length > 0 && (
        <div className="mk-table-wrap">
          <table className="mk-table">
            <tbody>
              {results.map((variant) => (
                <tr key={variant.variantId}>
                  <td>{variant.title}<div className="mk-help">{variant.sku || "no SKU"} · {variant.available === null ? "stock not tracked" : `${variant.available} in stock`}</div></td>
                  <td>{rupees(variant.unitPricePaise)}<div className="mk-help">{variant.unitCostPaise === null ? "no cost price" : `cost ${rupees(variant.unitCostPaise)}`}</div></td>
                  <td><button type="button" className="mk-btn" onClick={() => add(variant)}>Add</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lines.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {lines.map((line) => (
            <div key={line.variantId} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input className="mk-input" style={{ width: 64 }} inputMode="numeric" aria-label={`Quantity of ${line.title}`} value={line.quantity} onChange={(event) => { const quantity = Math.max(1, Math.min(50, Number(event.target.value.replace(/\D/g, "")) || 1)); setLines((current) => current.map((item) => item.variantId === line.variantId ? { ...item, quantity } : item)); }} />
              <span>{line.title}</span>
              <button type="button" className="mk-link" style={{ background: "none", border: 0 }} onClick={() => setLines((current) => current.filter((item) => item.variantId !== line.variantId))}>Remove</button>
            </div>
          ))}
          <p className="mk-help">Retail value {rupees(retail)} · product cost {rupees(cost)}. The courier is told the retail value; the customer pays nothing.</p>
        </div>
      )}
      <label className="mk-check" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={form.notifyRecipient} disabled={!form.recipientEmail} onChange={(event) => setForm((current) => ({ ...current, notifyRecipient: event.target.checked }))} />
        Email them the tracking link (Shopify shipping email)
      </label>
      <div><button type="button" className="mk-btn mk-btn-primary" disabled={saving || !lines.length} onClick={submit}>{saving ? "Creating…" : "Create order and book shipment"}</button></div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mk-field"><span className="mk-label">{label}</span>{children}</label>;
}
