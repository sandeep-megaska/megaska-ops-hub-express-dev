import assert from "node:assert/strict";
import test from "node:test";

process.env.SHOPIFY_API_SECRET = "test-app-proxy-secret";

const { createInternalAppProxySignature, isValidInternalAppProxySignature } = await import("./app-proxy-internal.ts");

test("internal app-proxy attestation rejects forged and stale forwarding headers", () => {
  const timestamp = "1700000000000";
  const signature = createInternalAppProxySignature({
    shopDomain: "example.myshopify.com",
    timestamp,
    method: "POST",
    pathname: "/api/reviews/submission/lookup",
  });

  assert.ok(signature);
  assert.equal(isValidInternalAppProxySignature({
    shopDomain: "example.myshopify.com",
    timestamp,
    signature,
    method: "POST",
    pathname: "/api/reviews/submission/lookup",
    now: Number(timestamp) + 60_000,
  }), true);
  assert.equal(isValidInternalAppProxySignature({
    shopDomain: "other.myshopify.com",
    timestamp,
    signature,
    method: "POST",
    pathname: "/api/reviews/submission/lookup",
    now: Number(timestamp),
  }), false);
  assert.equal(isValidInternalAppProxySignature({
    shopDomain: "example.myshopify.com",
    timestamp,
    signature,
    method: "POST",
    pathname: "/api/reviews/submission/lookup",
    now: Number(timestamp) + (6 * 60 * 1000),
  }), false);
});
