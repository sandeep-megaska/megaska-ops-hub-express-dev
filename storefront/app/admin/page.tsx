import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getPool } from "@/lib/db.ts";
import { getStoreId } from "@/lib/store.ts";
import { AdminActions, Revoke } from "./actions.tsx";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div className="admin">
      <h1>Storefront admin</h1>
      <AdminActions />
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <AdminStatus />
      </Suspense>
    </div>
  );
}

const fmt = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";

async function AdminStatus() {
  await connection();
  const storeId = await getStoreId();
  if (!storeId) return <p className="muted">Nothing imported yet.</p>;
  const db = getPool();
  const [counts, runs, keys, log] = await Promise.all([
    db.query(
      `select (select count(*) from products where store_id = $1 and status = 'active' and published)::int as live,
              (select count(*) from products where store_id = $1)::int as products,
              (select count(*) from product_variants where store_id = $1)::int as variants,
              (select count(*) from product_variants where store_id = $1 and inventory_source like 'api:%')::int as api_stock,
              (select count(*) from collections where store_id = $1)::int as collections,
              (select count(*) from url_redirects where store_id = $1)::int as redirects`,
      [storeId],
    ),
    db.query(
      `select kind, status, file_name, started_at, stats, jsonb_array_length(warnings) as warning_count, error
       from import_runs where store_id = $1 order by started_at desc limit 10`,
      [storeId],
    ),
    db.query(
      `select id, name, key_prefix, scopes, created_at, last_used_at, revoked_at
       from api_clients where store_id = $1 order by created_at desc`,
      [storeId],
    ),
    db.query(
      `select sku, quantity, previous, outcome, source, received_at
       from inventory_log where store_id = $1 order by id desc limit 30`,
      [storeId],
    ),
  ]);
  const c = counts.rows[0];
  return (
    <>
      <h2>Catalog</h2>
      <p>
        {c.live} live products ({c.products} total) · {c.variants} SKUs, {c.api_stock} with stock from Browntape ·{" "}
        {c.collections} collections · {c.redirects} redirects
      </p>

      <h2>Recent imports</h2>
      <table className="table">
        <thead><tr><th>When</th><th>What</th><th>Result</th></tr></thead>
        <tbody>
          {runs.rows.map((r, i) => (
            <tr key={i}>
              <td>{fmt(r.started_at)}</td>
              <td>{r.kind}{r.file_name ? ` · ${r.file_name}` : ""}</td>
              <td>
                {r.status === "failed" ? <span className="bad">Failed: {r.error}</span> : r.status}
                {r.status === "succeeded" && <code> {JSON.stringify(r.stats)}</code>}
                {r.warning_count > 0 && <span className="muted"> · {r.warning_count} warnings</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>API keys</h2>
      <table className="table">
        <thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th /></tr></thead>
        <tbody>
          {keys.rows.map((k) => (
            <tr key={k.id} className={k.revoked_at ? "revoked" : ""}>
              <td>{k.name}</td>
              <td><code>msk_{k.key_prefix}_…</code></td>
              <td>{k.scopes.join(", ")}</td>
              <td>{k.revoked_at ? `revoked ${fmt(k.revoked_at)}` : fmt(k.last_used_at)}</td>
              <td>{!k.revoked_at && <Revoke id={k.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Latest stock updates</h2>
      <table className="table">
        <thead><tr><th>When</th><th>SKU</th><th>Stock</th><th>Outcome</th><th>From</th></tr></thead>
        <tbody>
          {log.rows.map((l, i) => (
            <tr key={i}>
              <td>{fmt(l.received_at)}</td>
              <td>{l.sku}</td>
              <td>{l.previous ?? "—"} → {l.quantity}</td>
              <td>{l.outcome}</td>
              <td>{l.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
