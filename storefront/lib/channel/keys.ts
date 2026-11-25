import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getPool } from "../db.ts";

// API keys for systems that talk to the storefront (Browntape first).
// Format: msk_<prefix>_<secret>. Only a SHA-256 hash is stored; the full key
// is shown once, when it is created.

export const SCOPES = ["inventory:write", "inventory:read", "products:read"] as const;
export type Scope = (typeof SCOPES)[number];

export type ApiClient = { id: string; storeId: string; name: string; scopes: Scope[] };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function generateKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(5).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const key = `msk_${prefix}_${secret}`;
  return { key, prefix, hash: sha256(key) };
}

export function parseKey(key: string): { prefix: string } | null {
  const m = /^msk_([0-9a-f]{10})_[A-Za-z0-9_-]{32}$/.exec(key);
  return m ? { prefix: m[1] } : null;
}

export async function createApiClient(storeId: string, name: string, scopes: Scope[]): Promise<{ key: string; prefix: string }> {
  const bad = scopes.filter((s) => !SCOPES.includes(s));
  if (bad.length) throw new Error(`Unknown scope(s): ${bad.join(", ")}`);
  const { key, prefix, hash } = generateKey();
  await getPool().query(
    `insert into api_clients (store_id, name, key_prefix, key_hash, scopes) values ($1, $2, $3, $4, $5)`,
    [storeId, name.trim(), prefix, hash, scopes],
  );
  return { key, prefix };
}

export async function revokeApiClient(storeId: string, id: string): Promise<void> {
  await getPool().query(`update api_clients set revoked_at = now() where store_id = $1 and id = $2`, [storeId, id]);
}

/** Resolve "Authorization: Bearer msk_..." to an active client, or null. */
export async function authenticate(authorization: string | null): Promise<ApiClient | null> {
  const key = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key) return null;
  const parsed = parseKey(key);
  if (!parsed) return null;
  const { rows } = await getPool().query<{ id: string; store_id: string; name: string; scopes: Scope[]; key_hash: string }>(
    `select id, store_id, name, scopes, key_hash from api_clients where key_prefix = $1 and revoked_at is null`,
    [parsed.prefix],
  );
  const row = rows[0];
  if (!row) return null;
  const expected = Buffer.from(row.key_hash, "hex");
  const actual = Buffer.from(sha256(key), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  // Best effort; never fail a request over bookkeeping.
  getPool()
    .query(`update api_clients set last_used_at = now() where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')`, [row.id])
    .catch(() => {});
  return { id: row.id, storeId: row.store_id, name: row.name, scopes: row.scopes };
}
