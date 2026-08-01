"use client";
import { useEffect, useState } from "react";
import { FunnelChart, ShareBar, DeltaMeta } from "./charts";

type Comparison = { value: number; previousValue: number; percentageChange: number | null };
type Stage = {
  key: string;
  label: string;
  basis: "session" | "intent";
  count: number;
  conversionFromPrevious: number | null;
  dropOffFromPrevious: number | null;
};
type FunnelData = {
  funnel: {
    stages: Stage[];
    headline: Record<string, Comparison>;
    segments: {
      entryPoint: { key: string; label: string; sessions: number; share: number }[];
      device: { key: string; label: string; sessions: number; share: number }[];
    };
    notes: { basisHandoff: string };
  };
  paymentMix: {
    methods: { method: string; label: string; selected: number; completed: number; share: number; completionRate: number }[];
  };
};
type Cart = {
  id: string;
  startedAt: string;
  lastActivityAt: string;
  valuePaise: number;
  currency: string;
  lineCount: number;
  paymentMethod: string | null;
  furthestStep: string;
  mobileMasked: string | null;
  recovery: { status: string; sentAt: string | null; clickedAt: string | null };
};
type CartData = {
  summary: { abandonedCount: number; valueAtRiskPaise: number; recoverableCount: number };
  idleThresholdMinutes: number;
  carts: Cart[];
  recovery: { metrics: Record<string, Comparison> };
};

type LoginData = {
  metrics: Record<string, Comparison>;
  breakdown: {
    newVsReturning: { key: string; label: string; count: number }[];
    checkoutIdentity: { key: string; label: string; count: number }[];
  };
};

type AiInsight = {
  enabled: boolean;
  generatedAt?: string;
  model?: string;
  summary?: string;
  recommendations?: { title: string; detail: string; priority: "high" | "medium" | "low" }[];
  anomalies?: { title: string; detail: string }[];
  error?: string;
};

const LOGIN_LABELS: Record<string, string> = {
  verifiedLogins: "Mobile logins",
  uniqueCustomers: "Unique customers",
  newCustomers: "New customers",
  returningCustomers: "Returning customers",
  loginToPurchaseRate: "Login → purchase",
  identifiedCheckoutRate: "Identified checkout",
};
const HEADLINE_LABELS: Record<string, string> = {
  checkoutsStarted: "Checkouts started",
  ordersPlaced: "Orders placed",
  startToOrderConversion: "Start → order",
  topToOrderConversion: "Cart → order",
};
const RECOVERY_LABELS: Record<string, string> = {
  recoveryMessagesSent: "Recovery messages sent",
  recoveryClicks: "Recovery clicks",
  cartsRecovered: "Carts recovered",
  clickThroughRate: "Click-through rate",
  recoveryRate: "Recovery rate",
};

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(1)}%`);
const money = (paise: number, currency = "INR") => {
  const symbol = currency === "INR" ? "₹" : "";
  return `${symbol}${(paise / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};
const isRate = (key: string) => /conversion|rate/i.test(key);
const dateTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
};

function recoveryBadge(status: string) {
  const map: Record<string, string> = { used: "mk-badge-success", clicked: "mk-badge-info", sent: "mk-badge-neutral", none: "mk-badge-neutral" };
  const text: Record<string, string> = { used: "Recovered", clicked: "Clicked", sent: "Sent", none: "—" };
  return <span className={`mk-badge ${map[status] || "mk-badge-neutral"}`}>{text[status] || status}</span>;
}

export default function CheckoutAnalyticsClient({ shop }: { shop: string }) {
  const [range, setRange] = useState("30");
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [carts, setCarts] = useState<CartData | null>(null);
  const [logins, setLogins] = useState<LoginData | null>(null);
  const [ai, setAi] = useState<AiInsight | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setAi(null);
    fetch(`/api/admin/analytics/insights?shop=${encodeURIComponent(shop)}&range=${range}`)
      .then((r) => r.json())
      .then((x) => active && x.ok && setAi(x.insight))
      .catch(() => active && setAi({ enabled: false }));
    return () => {
      active = false;
    };
  }, [range, shop]);

  useEffect(() => {
    let active = true;
    setError("");
    setFunnel(null);
    setCarts(null);
    setLogins(null);
    const q = `shop=${encodeURIComponent(shop)}&range=${range}`;
    Promise.all([
      fetch(`/api/admin/analytics/checkout-funnel?${q}`).then((r) => r.json()),
      fetch(`/api/admin/analytics/abandoned-carts?${q}`).then((r) => r.json()),
      fetch(`/api/admin/analytics/logins?${q}`).then((r) => r.json()),
    ])
      .then(([f, c, l]) => {
        if (!active) return;
        if (f.ok) setFunnel(f); else setError(f.error || "Unable to load analytics.");
        if (c.ok) setCarts(c);
        if (l.ok) setLogins(l);
      })
      .catch(() => active && setError("Unable to load analytics."));
    return () => {
      active = false;
    };
  }, [range, shop]);

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Checkout analytics</h1>
          <p className="mk-page-subtitle">
            The express-checkout funnel Shopify can&rsquo;t see — where shoppers drop off, who abandons, and what to recover.
          </p>
        </div>
        <div className="mk-header-actions">
          <label className="mk-field">
            <span className="mk-label">Period</span>
            <select className="mk-select" value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last 12 months</option>
            </select>
          </label>
        </div>
      </div>

      {error && <div className="mk-alert mk-alert-error" role="alert">{error}</div>}

      {/* AI insights — loads independently so it never blocks the funnel. */}
      {ai === null && (
        <section className="mk-card"><p className="mk-help" aria-busy="true">✨ Generating AI insights…</p></section>
      )}
      {ai?.enabled && ai.error && (
        <section className="mk-card"><p className="mk-help">{ai.error}</p></section>
      )}
      {ai?.enabled && !ai.error && (ai.summary || ai.recommendations?.length) && (
        <section className="mk-card">
          <h2 className="mk-section-title">✨ AI insights</h2>
          {ai.summary && <p className="mk-section-subtitle">{ai.summary}</p>}
          {ai.recommendations && ai.recommendations.length > 0 && (
            <>
              <p className="mk-label" style={{ marginTop: "0.75rem" }}>Recommended actions</p>
              <ul style={{ display: "grid", gap: "0.5rem", paddingLeft: 0, listStyle: "none" }}>
                {ai.recommendations.map((r, i) => (
                  <li key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                    <span className={`mk-badge ${r.priority === "high" ? "mk-badge-danger" : r.priority === "medium" ? "mk-badge-warning" : "mk-badge-neutral"}`}>
                      {r.priority}
                    </span>
                    <span><strong>{r.title}</strong> — {r.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {ai.anomalies && ai.anomalies.length > 0 && (
            <>
              <p className="mk-label" style={{ marginTop: "0.75rem" }}>Anomalies</p>
              <ul style={{ display: "grid", gap: "0.5rem", paddingLeft: 0, listStyle: "none" }}>
                {ai.anomalies.map((a, i) => (
                  <li key={i}><strong>{a.title}</strong> — {a.detail}</li>
                ))}
              </ul>
            </>
          )}
          {ai.model && (
            <p className="mk-stat-meta" style={{ marginTop: "0.75rem" }}>
              Generated by {ai.model}{ai.generatedAt ? ` · ${dateTime(ai.generatedAt)}` : ""}
            </p>
          )}
        </section>
      )}

      {!funnel ? (
        <p className="mk-help" aria-busy="true">Loading analytics…</p>
      ) : (
        <>
          {/* Headline */}
          <section className="mk-grid-4">
            {Object.entries(funnel.funnel.headline).map(([key, metric]) => (
              <div key={key} className="mk-card mk-stat-card">
                <p className="mk-stat-label">{HEADLINE_LABELS[key] || key}</p>
                <p className="mk-stat-value">{isRate(key) ? pct(metric.value) : metric.value.toLocaleString()}</p>
                <DeltaMeta metric={metric} />
              </div>
            ))}
          </section>

          {/* Funnel */}
          <section className="mk-card">
            <h2 className="mk-section-title">Conversion funnel</h2>
            <p className="mk-section-subtitle">{funnel.funnel.notes.basisHandoff}</p>
            <FunnelChart stages={funnel.funnel.stages} />
            <details style={{ marginTop: "0.75rem" }}>
              <summary className="mk-stat-meta" style={{ cursor: "pointer" }}>View as table</summary>
              <div className="mk-table-wrap" style={{ marginTop: "0.5rem" }}>
                <table className="mk-table">
                  <caption>Express-checkout funnel stages and drop-off</caption>
                <thead>
                  <tr><th>Stage</th><th>Basis</th><th>Reached</th><th>Step conversion</th><th>Drop-off</th></tr>
                </thead>
                <tbody>
                  {funnel.funnel.stages.map((s) => (
                    <tr key={s.key}>
                      <td>{s.label}</td>
                      <td>{s.basis === "session" ? "Sessions" : "Checkouts"}</td>
                      <td>{s.count.toLocaleString()}</td>
                      <td>{s.conversionFromPrevious === null ? "—" : pct(s.conversionFromPrevious)}</td>
                      <td>
                        {s.dropOffFromPrevious === null ? "—" : (
                          <span className={s.dropOffFromPrevious > 0.5 ? "mk-badge mk-badge-warning" : "mk-badge mk-badge-neutral"}>
                            {pct(s.dropOffFromPrevious)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          {/* Segments */}
          <section className="mk-grid-3">
            <div className="mk-card">
              <h2 className="mk-section-title">Entry point</h2>
              <p className="mk-section-subtitle">Where the express-checkout click came from.</p>
              <ShareBar items={funnel.funnel.segments.entryPoint.map((e) => ({ label: e.label, value: e.sessions, share: e.share }))} />
            </div>
            <div className="mk-card">
              <h2 className="mk-section-title">Device</h2>
              <p className="mk-section-subtitle">Measured at the express-checkout click.</p>
              <ShareBar items={funnel.funnel.segments.device.map((d) => ({ label: d.label, value: d.sessions, share: d.share }))} />
            </div>
            <div className="mk-card">
              <h2 className="mk-section-title">Payment mix</h2>
              <p className="mk-section-subtitle">Share and completion by method.</p>
              {funnel.paymentMix.methods.length === 0 ? (
                <p className="mk-help">No payment selections yet.</p>
              ) : (
                <>
                  <ShareBar items={funnel.paymentMix.methods.map((m) => ({ label: m.label, value: m.selected, share: m.share }))} />
                  <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.25rem" }}>
                    {funnel.paymentMix.methods.map((m) => (
                      <span key={m.method} className="mk-stat-meta">{m.label} completion: {pct(m.completionRate)}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Customers & logins */}
          {logins && (
            <>
              <section className="mk-grid-4">
                {Object.entries(logins.metrics).map(([key, metric]) => (
                  <div key={key} className="mk-card mk-stat-card">
                    <p className="mk-stat-label">{LOGIN_LABELS[key] || key}</p>
                    <p className="mk-stat-value">{isRate(key) ? pct(metric.value) : metric.value.toLocaleString()}</p>
                    <DeltaMeta metric={metric} />
                  </div>
                ))}
              </section>
              <section className="mk-grid-3">
                <div className="mk-card">
                  <h2 className="mk-section-title">New vs returning</h2>
                  <p className="mk-section-subtitle">Customers who signed in this period.</p>
                  <div className="mk-table-wrap">
                    <table className="mk-table">
                      <thead><tr><th>Segment</th><th>Customers</th></tr></thead>
                      <tbody>
                        {logins.breakdown.newVsReturning.map((b) => (
                          <tr key={b.key}><td>{b.label}</td><td>{b.count.toLocaleString()}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="mk-card">
                  <h2 className="mk-section-title">Checkout identity</h2>
                  <p className="mk-section-subtitle">Express checkouts started, signed in vs guest.</p>
                  <div className="mk-table-wrap">
                    <table className="mk-table">
                      <thead><tr><th>Type</th><th>Checkouts</th></tr></thead>
                      <tbody>
                        {logins.breakdown.checkoutIdentity.map((b) => (
                          <tr key={b.key}><td>{b.label}</td><td>{b.count.toLocaleString()}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* Abandoned carts */}
          {carts && (
            <>
              <section className="mk-grid-4">
                <div className="mk-card mk-stat-card">
                  <p className="mk-stat-label">Abandoned carts</p>
                  <p className="mk-stat-value">{carts.summary.abandonedCount.toLocaleString()}</p>
                  <p className="mk-stat-meta">Idle &gt; {carts.idleThresholdMinutes}m, no order</p>
                </div>
                <div className="mk-card mk-stat-card">
                  <p className="mk-stat-label">Value at risk</p>
                  <p className="mk-stat-value">{money(carts.summary.valueAtRiskPaise)}</p>
                  <p className="mk-stat-meta">Recoverable: {carts.summary.recoverableCount}</p>
                </div>
                {carts.recovery && Object.entries(carts.recovery.metrics).slice(0, 2).map(([key, metric]) => (
                  <div key={key} className="mk-card mk-stat-card">
                    <p className="mk-stat-label">{RECOVERY_LABELS[key] || key}</p>
                    <p className="mk-stat-value">{isRate(key) ? pct(metric.value) : metric.value.toLocaleString()}</p>
                    <DeltaMeta metric={metric} />
                  </div>
                ))}
              </section>

              <section className="mk-card">
                <h2 className="mk-section-title">Abandoned carts</h2>
                <p className="mk-section-subtitle">
                  Express-checkout carts that stalled before an order. Mobile numbers are masked.
                </p>
                <div className="mk-table-wrap">
                  <table className="mk-table">
                    <caption>Recoverable abandoned express-checkout carts</caption>
                    <thead>
                      <tr>
                        <th>Started</th><th>Last activity</th><th>Value</th><th>Items</th>
                        <th>Furthest step</th><th>Method</th><th>Mobile</th><th>Recovery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {carts.carts.length === 0 ? (
                        <tr><td colSpan={8} className="mk-help">No abandoned carts in this period. 🎉</td></tr>
                      ) : carts.carts.map((c) => (
                        <tr key={c.id}>
                          <td>{dateTime(c.startedAt)}</td>
                          <td>{dateTime(c.lastActivityAt)}</td>
                          <td>{money(c.valuePaise, c.currency)}</td>
                          <td>{c.lineCount}</td>
                          <td>{c.furthestStep}</td>
                          <td>{c.paymentMethod || "—"}</td>
                          <td>{c.mobileMasked || "Guest"}</td>
                          <td>{recoveryBadge(c.recovery.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
