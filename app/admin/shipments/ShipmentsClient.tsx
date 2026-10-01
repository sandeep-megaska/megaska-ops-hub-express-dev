"use client";

import { useMemo, useState } from "react";
import { adminAuthHeaders } from "../../../lib/admin-fetch";

const CHUNK_SIZE = 10; // matches MAX_ORDERS_PER_CREATE_REQUEST on the server

type ExistingShipment =
  | { state: "NONE" }
  | { state: "CREATED"; awb: string | null; trackingUrl: string | null; shopify: { status: "DONE" | "FAILED" | "PENDING" | null; error: string | null } }
  | { state: "FAILED"; error: string | null }
  | { state: "INTERRUPTED"; error: string }
  | { state: "IN_PROGRESS" };

type PreviewOrder = {
  id: string;
  name: string;
  createdAt: string;
  customerName: string;
  city: string;
  pin: string;
  itemCount: number;
  totalPaise: number;
  payment: { ok: true; mode: "PREPAID" | "COD"; codAmountPaise: number; source: string } | { ok: false; reason: string };
  blockers: string[];
  warnings: string[];
  shipment: ExistingShipment;
};

type Preview = {
  delhivery: { configured: boolean; reason: string | null; pickupLocationName: string | null };
  orders: PreviewOrder[];
  truncated: boolean;
};

type ShopifyStep = { status: "DONE" | "ALREADY" | "FAILED" | "SKIPPED"; error?: string };

type CreateResult =
  | { orderId: string; orderName: string; outcome: "created" | "already_created"; awb: string | null; trackingUrl: string | null; shopify?: ShopifyStep }
  | { orderId: string; orderName: string; outcome: "skipped" | "failed"; error: string };

function dateInput(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// Booked on Delhivery but not yet marked shipped in Shopify.
function needsShopifyUpdate(order: PreviewOrder) {
  return order.shipment.state === "CREATED" && Boolean(order.shipment.awb) && order.shipment.shopify.status !== "DONE" && order.shipment.shopify.status !== "PENDING";
}

function isSelectable(order: PreviewOrder, markFulfilled: boolean) {
  if (order.shipment.state === "CREATED") return markFulfilled && needsShopifyUpdate(order);
  return !order.blockers.length && order.shipment.state !== "IN_PROGRESS";
}

// Fresh orders are preselected; retries (failed bookings, Shopify updates) need a deliberate tick.
function isPreselected(order: PreviewOrder) {
  return isSelectable(order, true) && order.shipment.state === "NONE";
}

function shopifyStepLabel(step: ShopifyStep | undefined) {
  if (!step) return "Not updated (off)";
  if (step.status === "DONE") return "Marked shipped";
  if (step.status === "ALREADY") return "Already shipped";
  return step.error || (step.status === "FAILED" ? "Update failed" : "Skipped");
}

export default function ShipmentsClient() {
  const [mode, setMode] = useState<"date" | "range" | "list">("date");
  const [from, setFrom] = useState(dateInput(2));
  const [to, setTo] = useState(dateInput(0));
  const [numberFrom, setNumberFrom] = useState("");
  const [numberTo, setNumberTo] = useState("");
  const [numberList, setNumberList] = useState("");
  const [weightGrams, setWeightGrams] = useState("500");
  const [shippingMode, setShippingMode] = useState<"Surface" | "Express">("Surface");
  const [markFulfilled, setMarkFulfilled] = useState(true);
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<CreateResult[]>([]);
  const [error, setError] = useState("");

  const selectableOrders = useMemo(() => (preview?.orders || []).filter((order) => isSelectable(order, markFulfilled)), [preview, markFulfilled]);
  const selectedOrders = useMemo(() => (preview?.orders || []).filter((order) => selected.has(order.id)), [preview, selected]);
  // COD only for orders being booked now; Shopify-only retries don't book a parcel.
  const codTotal = selectedOrders.reduce((sum, order) => sum + (order.shipment.state !== "CREATED" && order.payment.ok && order.payment.mode === "COD" ? order.payment.codAmountPaise : 0), 0);
  const newSelectedCount = selectedOrders.filter((order) => order.shipment.state !== "CREATED").length;
  const actionLabel = newSelectedCount === selectedOrders.length
    ? `Create ${selectedOrders.length} shipment(s)`
    : newSelectedCount === 0
      ? `Update ${selectedOrders.length} order(s) in Shopify`
      : `Process ${selectedOrders.length} order(s)`;

  // keepResults: refresh statuses after booking without clearing the results panel.
  async function loadOrders(keepResults = false) {
    setLoading(true);
    if (!keepResults) {
      setError("");
      setResults([]);
    }
    try {
      const filters =
        mode === "date"
          ? { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString() }
          : mode === "range"
            ? { orderNumberFrom: numberFrom, orderNumberTo: numberTo }
            : { orderNumbers: numberList };
      const response = await fetch("/api/admin/shipments/orders", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await adminAuthHeaders()) },
        body: JSON.stringify(filters),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Could not load orders.");
      setPreview(body as Preview);
      setSelected(new Set((body as Preview).orders.filter(isPreselected).map((order) => order.id)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }

  async function createShipments() {
    const ids = selectedOrders.map((order) => order.id);
    if (!ids.length) return;
    const newOrders = selectedOrders.filter((order) => order.shipment.state !== "CREATED");
    const shopifyOnly = ids.length - newOrders.length;
    const codCount = newOrders.filter((order) => order.payment.ok && order.payment.mode === "COD").length;
    const lines = [];
    if (newOrders.length) {
      lines.push(`Book ${newOrders.length} shipment(s) on Delhivery: ${newOrders.length - codCount} prepaid, ${codCount} COD (collect ${rupees(codTotal)} in total). Weight ${weightGrams} g each, ${shippingMode}.`);
    }
    if (shopifyOnly) lines.push(`Mark ${shopifyOnly} already-booked order(s) as shipped in Shopify.`);
    lines.push(
      markFulfilled
        ? `Orders will be marked shipped in Shopify with the AWB${notifyCustomer ? " and customers emailed their tracking link" : " (no customer email)"}.`
        : "Shopify orders will NOT be marked shipped."
    );
    const confirmed = window.confirm(`${lines.join("\n\n")}\n\nContinue?`);
    if (!confirmed) return;

    setCreating(true);
    setError("");
    setResults([]);
    setProgress({ done: 0, total: ids.length });
    const collected: CreateResult[] = [];
    try {
      for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
        const chunk = ids.slice(index, index + CHUNK_SIZE);
        const response = await fetch("/api/admin/shipments/orders/create", {
          method: "POST",
          headers: { "content-type": "application/json", ...(await adminAuthHeaders()) },
          body: JSON.stringify({ orderIds: chunk, weightGrams: Number(weightGrams), shippingMode, markFulfilled, notifyCustomer }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || "Shipment creation failed.");
        collected.push(...(body.results as CreateResult[]));
        setResults([...collected]);
        setProgress({ done: Math.min(index + chunk.length, ids.length), total: ids.length });
        // A settings problem stops the server mid-chunk; don't keep sending.
        if ((body.results as CreateResult[]).some((result) => result.outcome === "skipped" && result.error.startsWith("Stopped:"))) break;
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Shipment creation failed.");
    } finally {
      setCreating(false);
      await loadOrders(true);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = selectableOrders.length > 0 && selectableOrders.every((order) => selected.has(order.id));
  const createdCount = results.filter((result) => result.outcome === "created").length;
  const failedCount = results.filter((result) => result.outcome === "failed" || result.outcome === "skipped").length;
  const shopifyFailedCount = results.filter((result) => "awb" in result && (result.shopify?.status === "FAILED" || result.shopify?.status === "SKIPPED")).length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="mk-card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {([
            ["date", "By date"],
            ["range", "Order number range"],
            ["list", "Specific orders"],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={`mk-btn mk-btn-sm ${mode === value ? "mk-btn-primary" : "mk-btn-ghost"}`} onClick={() => setMode(value)}>
              {label}
            </button>
          ))}
        </div>

        <div className="mk-form-grid" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          {mode === "date" && (
            <>
              <div className="mk-field">
                <label className="mk-label" htmlFor="ship-from">Ordered from</label>
                <input id="ship-from" className="mk-input" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
              </div>
              <div className="mk-field">
                <label className="mk-label" htmlFor="ship-to">Ordered to</label>
                <input id="ship-to" className="mk-input" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
              </div>
            </>
          )}
          {mode === "range" && (
            <>
              <div className="mk-field">
                <label className="mk-label" htmlFor="ship-num-from">From order #</label>
                <input id="ship-num-from" className="mk-input" inputMode="numeric" placeholder="1050" value={numberFrom} onChange={(event) => setNumberFrom(event.target.value.replace(/\D/g, ""))} />
              </div>
              <div className="mk-field">
                <label className="mk-label" htmlFor="ship-num-to">To order #</label>
                <input id="ship-num-to" className="mk-input" inputMode="numeric" placeholder="1080" value={numberTo} onChange={(event) => setNumberTo(event.target.value.replace(/\D/g, ""))} />
              </div>
            </>
          )}
          {mode === "list" && (
            <div className="mk-field" style={{ minWidth: 280, flex: 1 }}>
              <label className="mk-label" htmlFor="ship-list">Order numbers</label>
              <input id="ship-list" className="mk-input" placeholder="1051, 1054, #1060" value={numberList} onChange={(event) => setNumberList(event.target.value)} />
            </div>
          )}
          <button type="button" className="mk-btn mk-btn-primary" onClick={() => loadOrders()} disabled={loading || creating}>
            {loading ? "Loading…" : "Find orders"}
          </button>
        </div>
        <p className="mk-help">
          Only open, unfulfilled orders are listed. Orders you already booked directly in the Delhivery panel still show here,
          because Shopify doesn&apos;t know about them, so check older dates before booking them again.
        </p>
      </section>

      {error && <div className="mk-alert mk-alert-error">{error}</div>}

      {preview && !preview.delhivery.configured && (
        <div className="mk-alert mk-alert-warning">
          {preview.delhivery.reason || "Delhivery is not configured."} Shipments can&apos;t be booked until it is set up in Merchant Settings.
        </div>
      )}
      {preview?.truncated && (
        <div className="mk-alert mk-alert-info">Only the newest 500 open orders were scanned. Narrow the range to see older ones.</div>
      )}

      {results.length > 0 && (
        <section className="mk-card" style={{ display: "grid", gap: 8 }}>
          <h2 className="mk-section-title">
            Booking results: {createdCount} created{failedCount ? `, ${failedCount} not booked` : ""}
            {shopifyFailedCount ? `, ${shopifyFailedCount} not updated in Shopify` : ""}
          </h2>
          <div className="mk-table-wrap">
            <table className="mk-table">
              <thead>
                <tr><th>Order</th><th>Result</th><th>AWB / reason</th><th>Shopify</th></tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.orderId}>
                    <td>{result.orderName}</td>
                    <td>
                      <span className={`mk-badge ${result.outcome === "created" || result.outcome === "already_created" ? "mk-badge-success" : "mk-badge-danger"}`}>
                        {result.outcome === "created" ? "Created" : result.outcome === "already_created" ? "Already booked" : result.outcome === "failed" ? "Failed" : "Skipped"}
                      </span>
                    </td>
                    <td>
                      {"awb" in result
                        ? result.trackingUrl
                          ? <a className="mk-link" href={result.trackingUrl} target="_blank" rel="noreferrer">{result.awb || "Track"}</a>
                          : result.awb || "AWB pending"
                        : result.error}
                    </td>
                    <td>
                      {"awb" in result ? (
                        <span className={result.shopify?.status === "FAILED" ? "mk-help" : undefined} style={result.shopify?.status === "FAILED" ? { color: "#b42318" } : undefined}>
                          {shopifyStepLabel(result.shopify)}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {preview && (
        <section className="mk-card" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <h2 className="mk-section-title">{preview.orders.length} order(s) found</h2>
              <p className="mk-section-subtitle">
                {selectedOrders.length} selected{codTotal ? ` · COD to collect ${rupees(codTotal)}` : ""}
                {preview.delhivery.pickupLocationName ? ` · Pickup: ${preview.delhivery.pickupLocationName}` : ""}
              </p>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="mk-field">
                <label className="mk-label" htmlFor="ship-weight">Weight per parcel (g)</label>
                <input id="ship-weight" className="mk-input" style={{ width: 120 }} inputMode="numeric" value={weightGrams} onChange={(event) => setWeightGrams(event.target.value.replace(/\D/g, ""))} />
              </div>
              <div className="mk-field">
                <label className="mk-label" htmlFor="ship-mode">Mode</label>
                <select id="ship-mode" className="mk-select" value={shippingMode} onChange={(event) => setShippingMode(event.target.value === "Express" ? "Express" : "Surface")}>
                  <option value="Surface">Surface</option>
                  <option value="Express">Express</option>
                </select>
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <label className="mk-check" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={markFulfilled}
                    onChange={(event) => {
                      setMarkFulfilled(event.target.checked);
                      if (!event.target.checked) {
                        setSelected((current) => new Set([...current].filter((id) => preview.orders.find((order) => order.id === id)?.shipment.state !== "CREATED")));
                      }
                    }}
                  />
                  Mark shipped in Shopify with AWB
                </label>
                <label className="mk-check" style={{ display: "flex", gap: 6, alignItems: "center", opacity: markFulfilled ? 1 : 0.5 }}>
                  <input type="checkbox" checked={markFulfilled && notifyCustomer} disabled={!markFulfilled} onChange={(event) => setNotifyCustomer(event.target.checked)} />
                  Email customers their tracking link
                </label>
              </div>
              <button
                type="button"
                className="mk-btn mk-btn-success"
                onClick={createShipments}
                disabled={creating || loading || !selectedOrders.length || !preview.delhivery.configured || !Number(weightGrams)}
              >
                {creating && progress ? `Working ${progress.done}/${progress.total}…` : actionLabel}
              </button>
            </div>
          </div>

          {preview.orders.length === 0 ? (
            <div className="mk-empty"><p className="mk-empty-title">No unfulfilled orders match these filters.</p></div>
          ) : (
            <div className="mk-table-wrap">
              <table className="mk-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all ready orders"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(selectableOrders.map((order) => order.id)))}
                      />
                    </th>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Destination</th>
                    <th>Items</th>
                    <th>Payment</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.orders.map((order) => {
                    const selectable = isSelectable(order, markFulfilled);
                    return (
                      <tr key={order.id} style={selectable ? undefined : { opacity: 0.7 }}>
                        <td>
                          <input type="checkbox" aria-label={`Select ${order.name}`} disabled={!selectable || creating} checked={selected.has(order.id)} onChange={() => toggle(order.id)} />
                        </td>
                        <td>{order.name}</td>
                        <td>{new Date(order.createdAt).toLocaleDateString("en-IN")}</td>
                        <td>{order.customerName || "—"}</td>
                        <td>{[order.city, order.pin].filter(Boolean).join(" · ") || "—"}</td>
                        <td>{order.itemCount}</td>
                        <td>
                          {order.payment.ok
                            ? order.payment.mode === "COD"
                              ? <span className="mk-badge mk-badge-warning">COD {rupees(order.payment.codAmountPaise)}{order.payment.source === "partial_cod" ? " (balance)" : ""}</span>
                              : <span className="mk-badge mk-badge-success">Prepaid</span>
                            : <span className="mk-badge mk-badge-danger">Check</span>}
                        </td>
                        <td>
                          {order.shipment.state === "CREATED" ? (
                            <>
                              {order.shipment.trackingUrl
                                ? <a className="mk-link" href={order.shipment.trackingUrl} target="_blank" rel="noreferrer">Booked · {order.shipment.awb}</a>
                                : <span className="mk-badge mk-badge-success">Booked{order.shipment.awb ? ` · ${order.shipment.awb}` : ""}</span>}
                              {order.shipment.shopify.status === "PENDING" ? (
                                <div className="mk-help">Updating Shopify…</div>
                              ) : needsShopifyUpdate(order) ? (
                                <div className="mk-help" style={{ color: "#b42318" }}>
                                  {order.shipment.shopify.error ? `Shopify not updated: ${order.shipment.shopify.error}` : "Not marked shipped in Shopify yet"} · Tick to update.
                                </div>
                              ) : null}
                            </>
                          ) : order.shipment.state === "IN_PROGRESS" ? (
                            <span className="mk-badge mk-badge-info">Booking…</span>
                          ) : order.blockers.length ? (
                            <span className="mk-help" style={{ color: "#b42318" }}>{order.blockers.join(" ")}</span>
                          ) : order.shipment.state === "FAILED" || order.shipment.state === "INTERRUPTED" ? (
                            <span className="mk-help" style={{ color: "#b42318" }}>{order.shipment.error || "Last attempt failed"} · Tick to retry.</span>
                          ) : (
                            <span className="mk-badge mk-badge-neutral">Ready</span>
                          )}
                          {order.warnings.map((warning) => (
                            <div key={warning} className="mk-help">{warning}</div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
