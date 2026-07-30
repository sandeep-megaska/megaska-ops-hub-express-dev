"use client";

import type { CSSProperties } from "react";

// Import/export home for the Review module. Phase 1 ships export (a CSV backup /
// migration-out of every review). Import (Judge.me + Shopify Product Reviews CSV)
// extends this same component in the next phase.
export default function ReviewImportExportClient({ shop }: { shop: string }) {
  // Export is a plain GET keyed by ?shop= (same tenant resolution the analytics
  // endpoints use), so a download anchor is sufficient — no token dance needed.
  const exportHref = `/api/admin/reviews/export?shop=${encodeURIComponent(shop)}`;

  const buttonStyle: CSSProperties = {
    display: "inline-block",
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid #008060",
    background: "#008060",
    color: "#fff",
    textDecoration: "none",
    fontWeight: 600,
  };

  return (
    <section style={{ margin: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
      <h2 style={{ marginTop: 0 }}>Import &amp; export reviews</h2>
      <p style={{ marginTop: 4 }}>
        Download every review as a CSV backup, or (coming next) migrate reviews in
        from Judge.me or the Shopify Product Reviews app.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <a href={exportHref} download style={buttonStyle}>
          Export reviews (CSV)
        </a>
      </div>
      <p style={{ marginTop: 12, color: "#6b7280", fontSize: 13 }}>
        The CSV includes product, rating, title, body, author, status, merchant
        reply, and media URLs. Soft-deleted reviews are excluded.
      </p>
    </section>
  );
}
