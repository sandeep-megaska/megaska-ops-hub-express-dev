import test from "node:test";
import assert from "node:assert/strict";

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = "offline-token-test-key";
const { __resetOfflineTokenInFlightForTests, getFreshShopAccessToken } = await import("./offline-token.ts");
const { encryptShopifyToken, decryptShopifyToken } = await import("./token-crypto.ts");
const { ShopifyRefreshTokenRevokedError } = await import("./token-exchange.ts");
type TokenDb = import("./offline-token.ts").TokenDb;
type Grant = import("./token-exchange.ts").OfflineTokenGrant;

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const HOUR = 3600_000;

// In-memory Shop row with a real (serialising) lock, like pg_advisory_xact_lock.
function memoryDb(row: { accessToken: string; tokenExpiresAt: Date | null; refreshToken: string | null }) {
  const state = {
    id: "shop-1", shopDomain: "acme.myshopify.com", accessToken: null as string | null,
    accessTokenEncrypted: encryptShopifyToken(row.accessToken), tokenExpiresAt: row.tokenExpiresAt,
    refreshTokenEncrypted: row.refreshToken ? encryptShopifyToken(row.refreshToken) : null, refreshTokenExpiresAt: null as Date | null,
    cleared: false,
  };
  let chain = Promise.resolve();
  const api = {
    async load() { return state.cleared ? null : { ...state }; },
    async save(_id: string, grant: Grant) {
      state.accessTokenEncrypted = encryptShopifyToken(grant.accessToken);
      state.tokenExpiresAt = grant.expiresAt;
      state.refreshTokenEncrypted = grant.refreshToken ? encryptShopifyToken(grant.refreshToken) : null;
      state.refreshTokenExpiresAt = grant.refreshTokenExpiresAt;
      return state.accessTokenEncrypted;
    },
    async clear() { state.accessTokenEncrypted = null; state.refreshTokenEncrypted = null; state.tokenExpiresAt = null; },
  };
  const db: TokenDb = {
    ...api,
    withShopLock(_id, fn) {
      const run = chain.then(() => fn(api));
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { db, state };
}
const grant = (n: number): Grant => ({ accessToken: `shpat_${n}`, scopes: null, expiresAt: new Date(NOW + HOUR), refreshToken: `shprt_${n}`, refreshTokenExpiresAt: new Date(NOW + 90 * 24 * HOUR) });

test("a token with time left is used as is", async () => {
  __resetOfflineTokenInFlightForTests();
  const { db } = memoryDb({ accessToken: "shpat_0", tokenExpiresAt: new Date(NOW + 30 * 60_000), refreshToken: "shprt_0" });
  let refreshes = 0;
  const fresh = await getFreshShopAccessToken("acme.myshopify.com", { db, now: () => NOW, refresh: async () => { refreshes++; return grant(1); }, migrationEnabled: false });
  assert.equal(fresh?.accessToken, "shpat_0");
  assert.equal(refreshes, 0);
});

test("a token about to expire is refreshed once, and the rotated refresh token is stored", async () => {
  __resetOfflineTokenInFlightForTests();
  const { db, state } = memoryDb({ accessToken: "shpat_0", tokenExpiresAt: new Date(NOW + 60_000), refreshToken: "shprt_0" });
  const seen: string[] = [];
  const refresh = async (_shop: string, token: string) => { seen.push(token); await new Promise((r) => setTimeout(r, 10)); return grant(seen.length); };
  // Concurrent callers share one refresh.
  const results = await Promise.all([1, 2, 3].map(() => getFreshShopAccessToken("acme.myshopify.com", { db, now: () => NOW, refresh, migrationEnabled: false })));
  assert.deepEqual(seen, ["shprt_0"]);
  assert.deepEqual(results.map((r) => r?.accessToken), ["shpat_1", "shpat_1", "shpat_1"]);
  assert.equal(decryptShopifyToken(state.refreshTokenEncrypted), "shprt_1");
  assert.equal(state.tokenExpiresAt?.getTime(), NOW + HOUR);
});

test("a refresh that waited for the lock reuses the token another worker just stored", async () => {
  __resetOfflineTokenInFlightForTests();
  const { db, state } = memoryDb({ accessToken: "shpat_0", tokenExpiresAt: new Date(NOW + 60_000), refreshToken: "shprt_0" });
  // Simulate another server instance refreshing first: the row is renewed before our locked re-read.
  const racingDb: TokenDb = { ...db, withShopLock: (id, fn) => { state.accessTokenEncrypted = encryptShopifyToken("shpat_other"); state.tokenExpiresAt = new Date(NOW + HOUR); return db.withShopLock(id, fn); } };
  let refreshes = 0;
  const fresh = await getFreshShopAccessToken("acme.myshopify.com", { db: racingDb, now: () => NOW, refresh: async () => { refreshes++; return grant(9); }, migrationEnabled: false });
  assert.equal(fresh?.accessToken, "shpat_other");
  assert.equal(refreshes, 0, "never spends a refresh token another worker already rotated");
});

test("a refused refresh token clears the token so the next app open re-installs", async () => {
  __resetOfflineTokenInFlightForTests();
  const { db, state } = memoryDb({ accessToken: "shpat_0", tokenExpiresAt: new Date(NOW - 1), refreshToken: "shprt_dead" });
  const fresh = await getFreshShopAccessToken("acme.myshopify.com", { db, now: () => NOW, refresh: async () => { throw new ShopifyRefreshTokenRevokedError("401"); }, migrationEnabled: false });
  assert.equal(fresh, null);
  assert.equal(state.accessTokenEncrypted, null);
});

test("a temporary refresh failure keeps the current token for a retry", async () => {
  __resetOfflineTokenInFlightForTests();
  const { db, state } = memoryDb({ accessToken: "shpat_0", tokenExpiresAt: new Date(NOW + 60_000), refreshToken: "shprt_0" });
  const fresh = await getFreshShopAccessToken("acme.myshopify.com", { db, now: () => NOW, refresh: async () => { throw new Error("HTTP 503"); }, migrationEnabled: false });
  assert.equal(fresh?.accessToken, "shpat_0");
  assert.equal(decryptShopifyToken(state.refreshTokenEncrypted), "shprt_0");
});

test("a legacy non-expiring token is migrated only when migration is switched on", async () => {
  __resetOfflineTokenInFlightForTests();
  const off = memoryDb({ accessToken: "shpat_legacy", tokenExpiresAt: null, refreshToken: null });
  let migrations = 0;
  const migrate = async (_shop: string, token: string) => { assert.equal(token, "shpat_legacy"); migrations++; return grant(5); };
  assert.equal((await getFreshShopAccessToken("acme.myshopify.com", { db: off.db, now: () => NOW, migrate, migrationEnabled: false }))?.accessToken, "shpat_legacy");
  assert.equal(migrations, 0);

  __resetOfflineTokenInFlightForTests();
  const on = memoryDb({ accessToken: "shpat_legacy", tokenExpiresAt: null, refreshToken: null });
  assert.equal((await getFreshShopAccessToken("acme.myshopify.com", { db: on.db, now: () => NOW, migrate, migrationEnabled: true }))?.accessToken, "shpat_5");
  assert.equal(migrations, 1);
  assert.equal(decryptShopifyToken(on.state.refreshTokenEncrypted), "shprt_5");
});

test("unreadable token columns (migration not run yet) fall back to the caller's token", async () => {
  __resetOfflineTokenInFlightForTests();
  const broken: TokenDb = { load: async () => { throw new Error('column "refreshTokenEncrypted" does not exist'); }, withShopLock: async () => null as never, save: async () => null, clear: async () => {} };
  assert.equal(await getFreshShopAccessToken("acme.myshopify.com", { db: broken, now: () => NOW }), null);
});
