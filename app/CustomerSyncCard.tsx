"use client";

import { useState } from "react";

export default function CustomerSyncCard() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    try {
      setLoading(true);
      setError(null);
      setMessage(null);

      const res = await fetch("/api/admin/customers/sync", {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Sync failed");
      }

      setMessage(
        `Shop: ${data.shopDomain} | Fetched: ${data.fetched} | Upserted: ${data.upserted} | Skipped: ${data.skipped}`
      );
    } catch (err: any) {
      setError(err.message || "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mk-card">
      <h2 className="mk-section-title">Customer Sync</h2>
      <p className="mk-section-subtitle">
        Import customers for the current shop only.
      </p>

      <div className="mk-hero-actions">
        <button
          type="button"
          onClick={handleSync}
          className="mk-btn mk-btn-primary"
          disabled={loading}
        >
          {loading ? "Syncing..." : "Sync Customers"}
        </button>
      </div>

      {message ? <p style={{ marginTop: 12 }}>{message}</p> : null}
      {error ? <p style={{ marginTop: 12, color: "red" }}>{error}</p> : null}
    </section>
  );
}
