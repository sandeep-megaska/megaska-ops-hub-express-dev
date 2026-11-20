import test from "node:test";
import assert from "node:assert/strict";

import { exchangeSessionTokenForOfflineToken, migrateToExpiringOfflineToken, parseOfflineTokenGrant, refreshOfflineToken, ShopInstallError, ShopifyRefreshTokenRevokedError, shopNeedsInstall } from "./token-exchange.ts";

const installed = { isActive: true, uninstalledAt: null, accessToken: null, accessTokenEncrypted: "enc" };

test("a shop needs installing when it is missing, uninstalled, inactive or has no token", () => {
  assert.equal(shopNeedsInstall(null), true, "new install");
  assert.equal(shopNeedsInstall({ ...installed, isActive: false }), true, "inactive");
  assert.equal(shopNeedsInstall({ ...installed, uninstalledAt: new Date() }), true, "reinstall after uninstall");
  assert.equal(shopNeedsInstall({ ...installed, accessTokenEncrypted: null }), true, "token cleared");
  assert.equal(shopNeedsInstall(installed), false);
  assert.equal(shopNeedsInstall({ ...installed, accessToken: "plain", accessTokenEncrypted: null }), false);
});

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
function recorder(response: unknown, status = 200) {
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(String(init?.body))) });
    return new Response(JSON.stringify(response), { status });
  };
  return { calls, opts: { apiKey: "key", apiSecret: "secret", fetchImpl, now: () => NOW } };
}
const expiringGrant = { access_token: "shpat_new", scope: "read_orders,write_orders", expires_in: 3600, refresh_token: "shprt_1", refresh_token_expires_in: 7776000 };

test("token exchange asks for an expiring offline token and returns its refresh token", async () => {
  const { calls, opts } = recorder(expiringGrant);
  const result = await exchangeSessionTokenForOfflineToken("acme.myshopify.com", "session.jwt", opts);
  assert.deepEqual(result, {
    accessToken: "shpat_new", scopes: "read_orders,write_orders",
    expiresAt: new Date(NOW + 3600_000), refreshToken: "shprt_1", refreshTokenExpiresAt: new Date(NOW + 7776000_000),
  });
  assert.equal(calls[0].url, "https://acme.myshopify.com/admin/oauth/access_token");
  assert.deepEqual(calls[0].body, {
    client_id: "key",
    client_secret: "secret",
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: "session.jwt",
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });
});

test("refresh sends the refresh token and returns the rotated pair; a 401 means re-authenticate", async () => {
  const { calls, opts } = recorder({ ...expiringGrant, access_token: "shpat_2", refresh_token: "shprt_2" });
  const result = await refreshOfflineToken("acme.myshopify.com", "shprt_1", opts);
  assert.equal(result.accessToken, "shpat_2");
  assert.equal(result.refreshToken, "shprt_2");
  assert.deepEqual(calls[0].body, { client_id: "key", client_secret: "secret", grant_type: "refresh_token", refresh_token: "shprt_1" });
  const refused = recorder({ error: "invalid_request", error_description: "This request requires an active refresh_token" }, 401);
  await assert.rejects(refreshOfflineToken("acme.myshopify.com", "shprt_old", refused.opts), ShopifyRefreshTokenRevokedError);
  const busy = recorder({}, 503);
  await assert.rejects(refreshOfflineToken("acme.myshopify.com", "shprt_1", busy.opts), (error: unknown) => error instanceof ShopInstallError && !(error instanceof ShopifyRefreshTokenRevokedError));
});

test("migration swaps a non-expiring offline token for an expiring one", async () => {
  const { calls, opts } = recorder(expiringGrant);
  const result = await migrateToExpiringOfflineToken("acme.myshopify.com", "shpat_legacy", opts);
  assert.equal(result.refreshToken, "shprt_1");
  assert.deepEqual(calls[0].body, {
    client_id: "key", client_secret: "secret",
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: "shpat_legacy",
    subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });
});

test("token exchange fails clearly on an HTTP error or a missing token", async () => {
  const failing = recorder({}, 400);
  await assert.rejects(exchangeSessionTokenForOfflineToken("acme.myshopify.com", "t", failing.opts), ShopInstallError);
  const empty = recorder({});
  await assert.rejects(exchangeSessionTokenForOfflineToken("acme.myshopify.com", "t", empty.opts), /no access token/);
  await assert.rejects(exchangeSessionTokenForOfflineToken("acme.myshopify.com", "t", { ...empty.opts, apiKey: "", apiSecret: "" }), /credentials/);
});

test("a legacy grant without expiry fields parses as non-expiring", () => {
  assert.deepEqual(parseOfflineTokenGrant({ access_token: "shpat_old", scope: "read_orders" }, NOW), { accessToken: "shpat_old", scopes: "read_orders", expiresAt: null, refreshToken: null, refreshTokenExpiresAt: null });
});
