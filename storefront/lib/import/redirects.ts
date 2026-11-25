import type { Queryable } from "../db.ts";
import { parseCsvRecords } from "./csv.ts";

export type Redirect = { path: string; target: string };

/** Shopify matches redirect paths case-insensitively and ignores a trailing slash. */
export function normalizePath(path: string): string {
  let p = path.trim().toLowerCase();
  try {
    if (/^https?:\/\//.test(p)) p = new URL(p).pathname;
  } catch {
    // keep as is
  }
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

/**
 * Shopify's "URL redirects" export: columns "Redirect from" and "Redirect to".
 * Targets that point at a Shopify variant ID (?variant=123) lose the query
 * string: our variants have no Shopify IDs, so the product page is the best match.
 */
export function parseRedirectsCsv(text: string): { redirects: Redirect[]; warnings: string[] } {
  const { headers, records } = parseCsvRecords(text);
  if (!headers.includes("Redirect from") || !headers.includes("Redirect to")) {
    throw new Error(
      'This does not look like a Shopify redirects export: expected columns "Redirect from" and "Redirect to". ' +
        "In Shopify, go to Content > Menus > View URL redirects > Export.",
    );
  }
  const warnings: string[] = [];
  const seen = new Map<string, Redirect>();
  for (const r of records) {
    const from = r["Redirect from"];
    let to = r["Redirect to"];
    if (!from || !to) continue;
    if (/[?&]variant=\d+/.test(to)) {
      to = to.replace(/\?.*$/, "");
    }
    const path = normalizePath(from);
    if (seen.has(path)) warnings.push(`Duplicate redirect for ${path}; the last one wins`);
    seen.set(path, { path, target: to.trim() });
  }
  return { redirects: [...seen.values()], warnings };
}

/** Replace all redirects with the file's. */
export async function applyRedirects(db: Queryable, storeId: string, redirects: Redirect[]): Promise<number> {
  await db.query(`delete from url_redirects where store_id = $1`, [storeId]);
  if (!redirects.length) return 0;
  await db.query(
    `insert into url_redirects (store_id, path, target)
     select $1, r.path, r.target from jsonb_to_recordset($2::jsonb) as r(path text, target text)`,
    [storeId, JSON.stringify(redirects)],
  );
  return redirects.length;
}
