import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

import { verifyShopifySessionToken, SessionTokenError } from "./session-token.ts";

const SECRET = "test-shopify-api-secret";
const API_KEY = "test-api-key";
const NOW = 1_800_000_000; // fixed clock

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signToken(payload: Record<string, unknown>, opts?: { secret?: string; header?: Record<string, unknown> }): string {
  const header = b64url(Buffer.from(JSON.stringify(opts?.header ?? { alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", opts?.secret ?? SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://acme.myshopify.com/admin",
    dest: "https://acme.myshopify.com",
    aud: API_KEY,
    sub: "42",
    sid: "session-1",
    exp: NOW + 60,
    nbf: NOW - 60,
    iat: NOW - 60,
    ...overrides,
  };
}

const opts = { apiSecret: SECRET, apiKey: API_KEY, now: NOW };

test("accepts a valid token and returns the shop from dest", () => {
  const result = verifyShopifySessionToken(signToken(validPayload()), opts);
  assert.equal(result.shopDomain, "acme.myshopify.com");
  assert.equal(result.aud, API_KEY);
  assert.equal(result.sub, "42");
});

test("rejects a tampered signature", () => {
  const token = signToken(validPayload());
  const tampered = token.slice(0, -3) + (token.slice(-3) === "aaa" ? "bbb" : "aaa");
  assert.throws(() => verifyShopifySessionToken(tampered, opts), SessionTokenError);
});

test("rejects a token signed with the wrong secret", () => {
  const token = signToken(validPayload(), { secret: "attacker-secret" });
  assert.throws(() => verifyShopifySessionToken(token, opts), /signature/i);
});

test("rejects an audience mismatch (token minted for another app)", () => {
  const token = signToken(validPayload({ aud: "some-other-app-key" }));
  assert.throws(() => verifyShopifySessionToken(token, opts), /audience/i);
});

test("rejects an expired token", () => {
  const token = signToken(validPayload({ exp: NOW - 3600, nbf: NOW - 7200 }));
  assert.throws(() => verifyShopifySessionToken(token, opts), /expired/i);
});

test("rejects a token that is not yet valid (nbf in the future)", () => {
  const token = signToken(validPayload({ nbf: NOW + 3600, exp: NOW + 7200 }));
  assert.throws(() => verifyShopifySessionToken(token, opts), /not yet valid/i);
});

test("rejects a dest that is not a myshopify shop", () => {
  const token = signToken(validPayload({ dest: "https://evil.example.com", iss: "https://evil.example.com/admin" }));
  assert.throws(() => verifyShopifySessionToken(token, opts), /valid shop/i);
});

test("rejects an iss/dest shop mismatch", () => {
  const token = signToken(validPayload({ iss: "https://victim.myshopify.com/admin" }));
  assert.throws(() => verifyShopifySessionToken(token, opts), /iss\/dest/i);
});

test("rejects a malformed token", () => {
  assert.throws(() => verifyShopifySessionToken("not-a-jwt", opts), /malformed/i);
});
