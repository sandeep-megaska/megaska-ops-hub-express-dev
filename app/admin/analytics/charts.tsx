"use client";

// Dependency-free inline chart primitives for the analytics page. Colors are a
// validated categorical palette (CVD ΔE >= 15, contrast >= 3:1 on the light card
// surface) plus the app's status tokens for deltas. The accessible data tables
// remain in the page as the source of truth — these are the visual layer.

export const CHART_COLORS = ["#4f46e5", "#0891b2", "#7c3aed", "#db2777"];

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * Horizontal funnel: each stage's bar width is its share of the top stage, so
 * the taper reads as the drop-off. Direct labels carry the count + step
 * conversion (never a chart without its numbers).
 */
export function FunnelChart({
  stages,
}: {
  stages: { key: string; label: string; basis: "session" | "intent"; count: number; conversionFromPrevious: number | null }[];
}) {
  // Local, function-scoped max — must NOT be named `top` (that is the reserved
  // window.top global, which silently makes count/top === NaN).
  const maxCount = Math.max(1, stages[0]?.count ?? 0);
  return (
    <div role="img" aria-label="Express-checkout conversion funnel" style={{ display: "grid", gap: "0.7rem" }}>
      {stages.map((s) => {
        // SVG width in user units (viewBox 0..100) — reliable across nesting,
        // unlike percentage widths of block children in grid/flex contexts.
        const pct = Math.max(0, Math.min(100, (s.count / maxCount) * 100));
        const bad = s.conversionFromPrevious !== null && s.conversionFromPrevious < 0.5;
        return (
          <div key={s.key}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: "var(--text)" }}>{s.label}</span>
              <span style={{ color: "var(--muted)" }}>
                {s.count.toLocaleString()}
                {s.conversionFromPrevious !== null && (
                  <span style={{ color: bad ? "var(--danger-text)" : "var(--muted)" }}> · {pct1(s.conversionFromPrevious)}</span>
                )}
              </span>
            </div>
            <svg width="100%" height="14" viewBox="0 0 100 14" preserveAspectRatio="none" style={{ display: "block" }}>
              <rect x="0" y="0" width={100} height={14} rx={3} fill="#e8ebf1" />
              <rect x="0" y="0" width={pct} height={14} rx={3} style={{ fill: "var(--primary)" }} />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 100% stacked share bar with a 2px surface gap between segments and a
 * direct-labeled legend (identity never by color alone).
 */
export function ShareBar({ items }: { items: { label: string; value: number; share: number }[] }) {
  const total = items.reduce((n, i) => n + i.value, 0);
  return (
    <div>
      <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", gap: 2, background: "var(--line)" }}>
        {total > 0 &&
          items.map((it, i) => (
            <div
              key={i}
              title={`${it.label}: ${pct1(it.share)}`}
              style={{ width: `${it.share * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
            />
          ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.5rem" }}>
        {items.map((it, i) => (
          <span key={i} className="mk-stat-meta" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], display: "inline-block", flex: "0 0 auto" }} />
            {it.label} · {pct1(it.share)}{total ? ` (${it.value.toLocaleString()})` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Period-over-period delta. Status color ships with an arrow + text, never color
 * alone. "Up is good" is the default direction (headline/customer KPIs).
 */
export function DeltaMeta({ metric }: { metric: { percentageChange: number | null } }) {
  if (metric.percentageChange === null) {
    return <p className="mk-stat-meta">vs prior: n/a</p>;
  }
  const up = metric.percentageChange >= 0;
  return (
    <p className="mk-stat-meta" style={{ color: up ? "var(--success-text)" : "var(--danger-text)" }}>
      {up ? "▲" : "▼"} {Math.abs(metric.percentageChange).toFixed(1)}% vs prior
    </p>
  );
}
