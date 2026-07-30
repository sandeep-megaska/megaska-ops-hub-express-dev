"use client";

import { useState, type CSSProperties } from "react";

// Import/export home for the Review module.
// Export: a CSV backup / migration-out of every review.
// Import: migrate reviews in from Judge.me, the Shopify Product Reviews app, or
// a Megaska export, with a dry-run preview before committing.

type ImportResult = {
  platform: string;
  dryRun: boolean;
  totalDataRows: number;
  created: number;
  duplicatesSkippedInFile: number;
  duplicatesSkippedExisting: number;
  unmatched: number;
  failed: number;
  affectedProducts: number;
  productsResolvedByHandle: number;
  errors: { csvLine: number; message: string }[];
  errorsTruncated: boolean;
};

const PLATFORMS: { value: string; label: string }[] = [
  { value: "judge_me", label: "Judge.me" },
  { value: "shopify_native", label: "Shopify Product Reviews" },
  { value: "megaska", label: "Megaska export" },
  { value: "generic", label: "Other / generic CSV" },
];

const DEFAULT_STATUSES: { value: string; label: string }[] = [
  { value: "PUBLISHED", label: "Published (show immediately)" },
  { value: "PENDING_MODERATION", label: "Pending moderation" },
  { value: "HIDDEN", label: "Hidden" },
];

const primaryButton: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid #008060",
  background: "#008060",
  color: "#fff",
  textDecoration: "none",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButton: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid #008060",
  background: "#fff",
  color: "#008060",
  fontWeight: 600,
  cursor: "pointer",
};

export default function ReviewImportExportClient({ shop }: { shop: string }) {
  const exportHref = `/api/admin/reviews/export?shop=${encodeURIComponent(shop)}`;

  const [platform, setPlatform] = useState("judge_me");
  const [defaultStatus, setDefaultStatus] = useState("PUBLISHED");
  const [defaultVerified, setDefaultVerified] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setResult(null);
    setError("");
    if (!file) {
      setCsv("");
      setFileName("");
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function runImport(dryRun: boolean) {
    if (!csv.trim()) {
      setError("Choose a CSV file first.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/admin/reviews/import?shop=${encodeURIComponent(shop)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, platform, dryRun, defaultStatus, defaultVerified }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(payload.error || "Import failed.");
      } else {
        setResult(payload.data as ImportResult);
      }
    } catch {
      setError("Import request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ margin: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
      <h2 style={{ marginTop: 0 }}>Import &amp; export reviews</h2>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 4 }}>Export</h3>
        <p style={{ marginTop: 0, color: "#4b5563" }}>
          Download every review as a CSV backup. Includes product, rating, title,
          body, author, status, merchant reply, and media URLs. Soft-deleted
          reviews are excluded.
        </p>
        <a href={exportHref} download style={primaryButton}>
          Export reviews (CSV)
        </a>
      </div>

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "16px 0" }} />

      <div>
        <h3 style={{ marginBottom: 4 }}>Import</h3>
        <p style={{ marginTop: 0, color: "#4b5563" }}>
          Migrate existing reviews in from Judge.me, the Shopify Product Reviews
          app, or a Megaska export. Each row needs a <code>product_id</code>
          (numeric Shopify id) or a <code>product_handle</code> — handles are
          resolved to products automatically. Run a preview first — it validates
          and counts without saving anything.
        </p>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", marginTop: 12 }}>
          <label>
            Source platform
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4 }}>
              {PLATFORMS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label>
            Import reviews as
            <select value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4 }}>
              {DEFAULT_STATUSES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label style={{ alignSelf: "end" }}>
            <input type="checkbox" checked={defaultVerified} onChange={(e) => setDefaultVerified(e.target.checked)} />{" "}
            Mark as verified purchases
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label="Review CSV file" />
          {fileName && <span style={{ marginLeft: 8, color: "#4b5563" }}>{fileName}</span>}
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          <button type="button" onClick={() => runImport(true)} disabled={busy || !csv} style={secondaryButton}>
            Preview (dry run)
          </button>
          <button type="button" onClick={() => runImport(false)} disabled={busy || !csv} style={primaryButton}>
            Import reviews
          </button>
        </div>

        {busy && <p aria-busy="true" style={{ marginTop: 12 }}>Working…</p>}
        {error && <p role="alert" style={{ color: "#b91c1c", marginTop: 12 }}>{error}</p>}

        {result && (
          <div style={{ marginTop: 16, padding: 12, border: "1px solid #e5e7eb", borderRadius: 8, background: "#f9fafb" }}>
            <strong>{result.dryRun ? "Preview" : "Import complete"}</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              <li>{result.dryRun ? "Would create" : "Created"}: {result.created} review(s) across {result.affectedProducts} product(s)</li>
              <li>Rows read: {result.totalDataRows}</li>
              {result.productsResolvedByHandle > 0 && <li>Matched to products by handle: {result.productsResolvedByHandle}</li>}
              {result.duplicatesSkippedInFile > 0 && <li>Duplicate rows in file skipped: {result.duplicatesSkippedInFile}</li>}
              {result.duplicatesSkippedExisting > 0 && <li>Already-imported reviews skipped: {result.duplicatesSkippedExisting}</li>}
              {result.unmatched > 0 && <li>Rows whose product could not be matched (skipped): {result.unmatched}</li>}
              {result.failed > 0 && <li style={{ color: "#b91c1c" }}>Failed to save: {result.failed}</li>}
            </ul>
            {result.errors.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary>{result.errors.length} row issue(s){result.errorsTruncated ? " (showing first 500)" : ""}</summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {result.errors.slice(0, 50).map((issue, index) => (
                    <li key={index}>Line {issue.csvLine}: {issue.message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
