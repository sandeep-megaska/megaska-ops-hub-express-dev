// Keeps a shop's stored Admin API token usable. Expiring offline tokens last about an
// hour: shortly before expiry this refreshes them with the stored refresh token and
// saves the rotated pair. A legacy non-expiring token is swapped for an expiring one
// when SHOPIFY_MIGRATE_TO_EXPIRING_TOKENS=1 (or when Shopify has started refusing it).
//
// Shopify retires a refresh token once its successor is used, so two refreshes of
// the same shop must never run at once: each one holds a Postgres advisory lock for
// that shop and re-reads the row inside it, and this process also shares an in-flight
// refresh per shop.
import { prisma } from "../db/prisma";
import { decryptShopifyToken, encryptShopifyToken } from "./token-crypto";
import {
  migrateToExpiringOfflineToken,
  refreshOfflineToken,
  ShopifyRefreshTokenRevokedError,
  type OfflineTokenGrant,
} from "./token-exchange";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type TokenRow = {
  id: string;
  shopDomain: string;
  accessToken: string | null;
  accessTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  refreshTokenEncrypted: string | null;
  refreshTokenExpiresAt: Date | null;
};

export type FreshShopToken = { accessToken: string; accessTokenEncrypted: string | null; expiresAt: Date | null };

type Deps = {
  now?: () => number;
  refresh?: typeof refreshOfflineToken;
  migrate?: typeof migrateToExpiringOfflineToken;
  migrationEnabled?: boolean;
  db?: TokenDb;
};

export type TokenDb = {
  load(shopDomain: string): Promise<TokenRow | null>;
  /** Runs `fn` while holding this shop's lock; `fn` re-reads with `load`. */
  withShopLock<T>(shopId: string, fn: (db: Pick<TokenDb, "load" | "save" | "clear">) => Promise<T>): Promise<T>;
  save(shopId: string, grant: OfflineTokenGrant): Promise<string | null>;
  clear(shopId: string): Promise<void>;
};

const SELECT = `SELECT "id", "shopDomain", "accessToken", "accessTokenEncrypted", "tokenExpiresAt", "refreshTokenEncrypted", "refreshTokenExpiresAt" FROM "Shop" WHERE "shopDomain" = $1 LIMIT 1`;

function queries(client: { $queryRawUnsafe: typeof prisma.$queryRawUnsafe; $executeRawUnsafe: typeof prisma.$executeRawUnsafe }) {
  return {
    async load(shopDomain: string) {
      const rows = await client.$queryRawUnsafe<TokenRow[]>(SELECT, shopDomain);
      return rows[0] ?? null;
    },
    async save(shopId: string, grant: OfflineTokenGrant) {
      const accessTokenEncrypted = encryptShopifyToken(grant.accessToken);
      if (!accessTokenEncrypted) throw new Error("Token encryption is not configured");
      const refreshTokenEncrypted = grant.refreshToken ? encryptShopifyToken(grant.refreshToken) : null;
      await client.$executeRawUnsafe(
        `UPDATE "Shop" SET "accessToken" = NULL, "accessTokenEncrypted" = $2, "tokenExpiresAt" = $3, "refreshTokenEncrypted" = $4, "refreshTokenExpiresAt" = $5, "updatedAt" = NOW() WHERE "id" = $1`,
        shopId, accessTokenEncrypted, grant.expiresAt, refreshTokenEncrypted, grant.refreshTokenExpiresAt,
      );
      return accessTokenEncrypted;
    },
    // A refresh token Shopify has retired can't be recovered: drop the token so the
    // next time the merchant opens the app, ensureShopInstalled exchanges a new one.
    async clear(shopId: string) {
      await client.$executeRawUnsafe(
        `UPDATE "Shop" SET "accessToken" = NULL, "accessTokenEncrypted" = NULL, "tokenExpiresAt" = NULL, "refreshTokenEncrypted" = NULL, "refreshTokenExpiresAt" = NULL, "updatedAt" = NOW() WHERE "id" = $1`,
        shopId,
      );
    },
  };
}

const prismaTokenDb: TokenDb = {
  ...queries(prisma),
  withShopLock(shopId, fn) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `shopify-offline-token:${shopId}`);
      return fn(queries(tx as unknown as typeof prisma));
    }, { timeout: 30_000, maxWait: 30_000 });
  },
};

function migrationEnabled() {
  return String(process.env.SHOPIFY_MIGRATE_TO_EXPIRING_TOKENS || "").trim() === "1";
}

function current(row: TokenRow): FreshShopToken | null {
  const accessToken = String(row.accessToken || "").trim() || decryptShopifyToken(row.accessTokenEncrypted);
  return accessToken ? { accessToken, accessTokenEncrypted: row.accessTokenEncrypted, expiresAt: row.tokenExpiresAt } : null;
}

function needsRefresh(row: TokenRow, now: number) {
  return Boolean(row.tokenExpiresAt && new Date(row.tokenExpiresAt).getTime() - now < REFRESH_MARGIN_MS);
}

const inFlight = new Map<string, Promise<FreshShopToken | null>>();

async function renew(row: TokenRow, deps: Required<Omit<Deps, "db">> & { db: TokenDb }, reason: "refresh" | "migrate"): Promise<FreshShopToken | null> {
  return deps.db.withShopLock(row.id, async (locked) => {
    const latest = await locked.load(row.shopDomain);
    if (!latest) return null;
    const now = deps.now();
    // Another request may have renewed it while we waited for the lock.
    if (reason === "refresh" && !needsRefresh(latest, now)) return current(latest);
    if (reason === "migrate" && latest.tokenExpiresAt) return current(latest);

    try {
      let grant: OfflineTokenGrant;
      if (reason === "refresh") {
        const refreshToken = decryptShopifyToken(latest.refreshTokenEncrypted);
        if (!refreshToken) {
          console.error("[SHOPIFY TOKEN] expiring token has no refresh token", { shopDomain: latest.shopDomain });
          return current(latest);
        }
        grant = await deps.refresh(latest.shopDomain, refreshToken);
      } else {
        const legacy = current(latest);
        if (!legacy) return null;
        grant = await deps.migrate(latest.shopDomain, legacy.accessToken);
      }
      const accessTokenEncrypted = await locked.save(latest.id, grant);
      console.info(`[SHOPIFY TOKEN] ${reason === "refresh" ? "refreshed" : "migrated to expiring"}`, { shopDomain: latest.shopDomain, expiresAt: grant.expiresAt?.toISOString() ?? null });
      return { accessToken: grant.accessToken, accessTokenEncrypted, expiresAt: grant.expiresAt };
    } catch (error) {
      if (error instanceof ShopifyRefreshTokenRevokedError) {
        console.error("[SHOPIFY TOKEN] refresh token refused; the merchant must reopen the app", { shopDomain: latest.shopDomain });
        await locked.clear(latest.id);
        return null;
      }
      // Network errors, 5xx and 429 are safe to retry with the same refresh token on
      // the next request; keep using the current token until then.
      console.error(`[SHOPIFY TOKEN] ${reason} failed`, { shopDomain: latest.shopDomain, error: error instanceof Error ? error.message : String(error) });
      return current(latest);
    }
  });
}

/**
 * The shop's Admin API token, refreshed or migrated first when needed. Returns null
 * when the shop has no usable token. If the token columns can't be read (for example
 * before the database migration has run), returns null and callers keep their own
 * decrypted token.
 */
export async function getFreshShopAccessToken(shopDomain: string, deps: Deps = {}): Promise<FreshShopToken | null> {
  const resolved = {
    now: deps.now ?? Date.now,
    refresh: deps.refresh ?? refreshOfflineToken,
    migrate: deps.migrate ?? migrateToExpiringOfflineToken,
    migrationEnabled: deps.migrationEnabled ?? migrationEnabled(),
    db: deps.db ?? prismaTokenDb,
  };
  let row: TokenRow | null;
  try {
    row = await resolved.db.load(shopDomain);
  } catch (error) {
    console.warn("[SHOPIFY TOKEN] token columns unavailable", { shopDomain, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
  if (!row) return null;

  const reason = needsRefresh(row, resolved.now()) ? "refresh" : !row.tokenExpiresAt && resolved.migrationEnabled && current(row) ? "migrate" : null;
  if (!reason) return current(row);

  const pending = inFlight.get(row.id);
  if (pending) return pending;
  const task = renew(row, resolved, reason).finally(() => inFlight.delete(row.id));
  inFlight.set(row.id, task);
  return task;
}

export function __resetOfflineTokenInFlightForTests() { inFlight.clear(); }
