"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const HEADERS = { "x-megaska-admin": "1" };

type Result = { ok: boolean; error?: string; stats?: unknown; warnings?: string[]; key?: string };

function Upload({ kind, label, help, accept, withMode, optionalFile }: {
  kind: string; label: string; help: string; accept: string; withMode?: boolean; optionalFile?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/import/${kind}`, { method: "POST", headers: HEADERS, body: new FormData(event.currentTarget) });
      setResult(await res.json());
      router.refresh();
    } catch (error) {
      setResult({ ok: false, error: String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h3>{label}</h3>
      <p className="muted">{help}</p>
      <input type="file" name="file" accept={accept} required={!optionalFile} />
      {withMode && (
        <label className="row">
          <input type="checkbox" name="mode" value="full" /> This file is the whole catalog: archive products not in it
        </label>
      )}
      <button className="buy" type="submit" disabled={busy}>{busy ? "Importing…" : "Import"}</button>
      {result && <ResultView result={result} />}
    </form>
  );
}

function ResultView({ result }: { result: Result }) {
  return (
    <div className={result.ok ? "ok" : "bad"}>
      {result.ok ? "Done." : `Failed: ${result.error}`}
      {result.stats !== undefined && result.stats !== null && (
        <ul className="stats">
          {Object.entries(result.stats as Record<string, unknown>).map(([k, v]) => (
            <li key={k}>{k.replace(/([A-Z])/g, " $1").toLowerCase()}: <b>{String(v)}</b></li>
          ))}
        </ul>
      )}
      {result.warnings && result.warnings.length > 0 && (
        <details>
          <summary>{result.warnings.length} warnings</summary>
          <ul>{result.warnings.slice(0, 200).map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function CreateKey() {
  const router = useRouter();
  const [name, setName] = useState("Browntape");
  const [result, setResult] = useState<Result | null>(null);

  async function create() {
    const res = await fetch("/api/admin/api-keys", {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setResult(await res.json());
    router.refresh();
  }

  return (
    <div className="panel">
      <h3>Create an API key</h3>
      <p className="muted">For Browntape or another system. The key is shown once: copy it into that system straight away.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Key name" />
      <button className="buy" type="button" onClick={create}>Create key</button>
      {result?.ok && result.key && (
        <div className="ok">
          Key for {name}: <code className="secret">{result.key}</code>
          <div className="muted">This is the only time it is shown. Revoke and create a new one if it is lost.</div>
        </div>
      )}
      {result && !result.ok && <div className="bad">{result.error}</div>}
    </div>
  );
}

export function Revoke({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="link"
      onClick={async () => {
        if (!confirm("Revoke this key? Systems using it will stop working.")) return;
        await fetch("/api/admin/api-keys", {
          method: "DELETE",
          headers: { ...HEADERS, "content-type": "application/json" },
          body: JSON.stringify({ id }),
        });
        router.refresh();
      }}
    >
      Revoke
    </button>
  );
}

export function AdminActions() {
  return (
    <div className="panels">
      <Upload
        kind="products"
        label="1. Products (Shopify CSV)"
        help="Shopify admin → Products → Export → All products → CSV for Excel, Numbers, or other spreadsheet programs."
        accept=".csv,text/csv"
        withMode
      />
      <Upload
        kind="collections"
        label="2. Collections"
        help="Leave empty to load Megaska's 31 collections (rules, manual lists, best-seller order). Or upload an edited collections JSON."
        accept=".json,application/json"
        optionalFile
      />
      <Upload
        kind="redirects"
        label="3. URL redirects (Shopify CSV)"
        help="Shopify admin → Content → Menus → View URL redirects → Export. Replaces all redirects."
        accept=".csv,text/csv"
      />
      <CreateKey />
    </div>
  );
}

