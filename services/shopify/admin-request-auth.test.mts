import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

import {
  ADMIN_HMAC_MAX_AGE_SECONDS,
  MEDIA_URL_TTL_SECONDS,
  sessionBounceUrl,
  signAdminMediaQuery,
  verifyAdminMediaQuery,
  verifyAdminRequest,
} from "./admin-request-auth.ts";

const SECRET = "test-shopify-api-secret";
const API_KEY = "test-api-key";
const NOW = 1_800_000_000;
const keys = { apiSecret: SECRET, apiKey: API_KEY, now: NOW };

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function token(shop = "acme.myshopify.com", overrides: Record<string, unknown> = {}, secret = SECRET) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: API_KEY, sub: "1", exp: NOW + 60, nbf: NOW - 5, iat: NOW - 5, ...overrides,
  })));
  const sig = b64url(crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

// Shopify's app-load URL: every param except hmac, sorted, signed with the app secret.
function signedAdminParams(values: Record<string, string>, secret = SECRET) {
  const message = Object.keys(values).sort().map((key) => `${key}=${values[key]}`).join("&");
  const params = new URLSearchParams(values);
  params.set("hmac", crypto.createHmac("sha256", secret).update(message).digest("hex"));
  return params;
}

test("a bare ?shop= param is never enough", () => {
  const result = verifyAdminRequest({ ...keys, params: new URLSearchParams({ shop: "victim.myshopify.com" }) });
  assert.equal(result.ok, false);
});

test("a valid bearer session token names the shop", () => {
  const result = verifyAdminRequest({ ...keys, authorization: `Bearer ${token()}`, params: new URLSearchParams({ shop: "victim.myshopify.com" }) });
  assert.deepEqual(result, { ok: true, shopDomain: "acme.myshopify.com", method: "session_token" });
});

test("an invalid bearer token fails without falling back to the URL", () => {
  const forged = token("acme.myshopify.com", {}, "wrong-secret");
  const params = signedAdminParams({ shop: "acme.myshopify.com", timestamp: String(NOW) });
  const result = verifyAdminRequest({ ...keys, authorization: `Bearer ${forged}`, params });
  assert.equal(result.ok, false);
});

test("the app-load id_token in the URL names the shop", () => {
  const result = verifyAdminRequest({ ...keys, params: new URLSearchParams({ id_token: token("shop-b.myshopify.com") }) });
  assert.deepEqual(result, { ok: true, shopDomain: "shop-b.myshopify.com", method: "id_token" });
});

test("an expired URL id_token is rejected", () => {
  const stale = token("acme.myshopify.com", { exp: NOW - 120 });
  assert.equal(verifyAdminRequest({ ...keys, params: new URLSearchParams({ id_token: stale }) }).ok, false);
});

test("a fresh Shopify HMAC is accepted, an old or tampered one is not", () => {
  const fresh = signedAdminParams({ shop: "acme.myshopify.com", host: "abc", timestamp: String(NOW - 30) });
  assert.deepEqual(verifyAdminRequest({ ...keys, params: fresh }), { ok: true, shopDomain: "acme.myshopify.com", method: "hmac" });

  const old = signedAdminParams({ shop: "acme.myshopify.com", timestamp: String(NOW - ADMIN_HMAC_MAX_AGE_SECONDS - 1) });
  assert.equal(verifyAdminRequest({ ...keys, params: old }).ok, false);

  const tampered = new URLSearchParams(fresh);
  tampered.set("shop", "victim.myshopify.com");
  assert.equal(verifyAdminRequest({ ...keys, params: tampered }).ok, false);
});

test("an expired id_token falls back to a fresh HMAC on the same URL", () => {
  const params = signedAdminParams({ shop: "acme.myshopify.com", id_token: token("acme.myshopify.com", { exp: NOW - 120 }), timestamp: String(NOW) });
  assert.deepEqual(verifyAdminRequest({ ...keys, params }), { ok: true, shopDomain: "acme.myshopify.com", method: "hmac" });
});

test("the bounce keeps shop context, returns to the same path, and never loops", () => {
  const bounce = sessionBounceUrl("/admin/wallets?shop=acme.myshopify.com&host=abc&page=2", NOW * 1000);
  assert.ok(bounce);
  const url = new URL(bounce!, "https://app.test");
  assert.equal(url.pathname, "/admin/session-bounce");
  assert.equal(url.searchParams.get("shop"), "acme.myshopify.com");
  assert.equal(url.searchParams.get("host"), "abc");
  assert.equal(url.searchParams.get("return"), "/admin/wallets?shop=acme.myshopify.com&host=abc&page=2");

  assert.equal(sessionBounceUrl(`/admin/wallets?loopd2c_bounce=${NOW * 1000 - 5_000}`, NOW * 1000), null, "just bounced");
  assert.ok(sessionBounceUrl(`/admin/wallets?loopd2c_bounce=${NOW * 1000 - 120_000}`, NOW * 1000), "an old bounce mark is ignored");
  assert.equal(sessionBounceUrl("/admin/session-bounce?return=/admin", NOW * 1000), null);
  assert.equal(sessionBounceUrl("//evil.example/admin", NOW * 1000), null);
  assert.equal(sessionBounceUrl("https://evil.example/admin", NOW * 1000), null);
  assert.equal(sessionBounceUrl(null, NOW * 1000), null);
});

test("media URLs are signed per shop and media id, and expire", () => {
  const query = new URLSearchParams(signAdminMediaQuery("acme.myshopify.com", "m1", keys));
  assert.equal(verifyAdminMediaQuery("m1", query, keys), "acme.myshopify.com");
  assert.equal(verifyAdminMediaQuery("m2", query, keys), null, "another media id");

  const otherShop = new URLSearchParams(query);
  otherShop.set("shop", "victim.myshopify.com");
  assert.equal(verifyAdminMediaQuery("m1", otherShop, keys), null, "shop swapped");

  assert.equal(verifyAdminMediaQuery("m1", query, { ...keys, now: NOW + MEDIA_URL_TTL_SECONDS + 1 }), null, "expired");
  assert.equal(verifyAdminMediaQuery("m1", new URLSearchParams({ shop: "acme.myshopify.com" }), keys), null, "unsigned");
});
