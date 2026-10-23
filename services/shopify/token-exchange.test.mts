import test from "node:test";
import assert from "node:assert/strict";

import { exchangeSessionTokenForOfflineToken, ShopInstallError, shopNeedsInstall } from "./token-exchange.ts";

const installed = { isActive: true, uninstalledAt: null, accessToken: null, accessTokenEncrypted: "enc" };

test("a shop needs installing when it is missing, uninstalled, inactive or has no token", () => {
  assert.equal(shopNeedsInstall(null), true, "new install");
  assert.equal(shopNeedsInstall({ ...installed, isActive: false }), true, "inactive");
  assert.equal(shopNeedsInstall({ ...installed, uninstalledAt: new Date() }), true, "reinstall after uninstall");
  assert.equal(shopNeedsInstall({ ...installed, accessTokenEncrypted: null }), true, "token cleared");
  assert.equal(shopNeedsInstall(installed), false);
  assert.equal(shopNeedsInstall({ ...installed, accessToken: "plain", accessTokenEncrypted: null }), false);
});

test("token exchange posts the session token and returns the offline token", async () => {
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ access_token: "shpat_x", scope: "read_orders,write_orders" }), { status: 200 });
  };
  const result = await exchangeSessionTokenForOfflineToken("acme.myshopify.com", "session.jwt", { apiKey: "key", apiSecret: "secret", fetchImpl });
  assert.deepEqual(result, { accessToken: "shpat_x", scopes: "read_orders,write_orders" });
  assert.equal(calls[0].url, "https://acme.myshopify.com/admin/oauth/access_token");
  assert.deepEqual(calls[0].body, {
    client_id: "key",
    client_secret: "secret",
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: "session.jwt",
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
  });
});

test("token exchange fails clearly on an HTTP error or a missing token", async () => {
  const failing = async () => new Response("{}", { status: 400 });
  await assert.rejects(exchangeSessionTokenForOfflineToken("acme.myshopify.com", "t", { apiKey: "k", apiSecret: "s", fetchImpl: failing }), ShopInstallError);
  const empty = async () => new Response(JSON.stringify({}), { status: 200 });
  await assert.rejects(exchangeSessionTokenForOfflineToken("acme.myshopify.com", "t", { apiKey: "k", apiSecret: "s", fetchImpl: empty }), /no access token/);
  await assert.rejects(exchangeSessionTokenForOfflineToken("acme.myshopify.com", "t", { apiKey: "", apiSecret: "", fetchImpl: empty }), /credentials/);
});
