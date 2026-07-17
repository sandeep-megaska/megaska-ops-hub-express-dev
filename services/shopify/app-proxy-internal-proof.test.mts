import assert from "node:assert/strict";
import test from "node:test";
import { createInternalAppProxyProof, verifyInternalAppProxyProof } from "./app-proxy-internal-proof.ts";

test("internal app-proxy proof rejects browser-forgeable marker headers", () => {
  const secret = "test-secret";
  const now = Date.now();
  const timestamp = String(now);
  const proof = createInternalAppProxyProof({
    secret,
    timestamp,
    method: "POST",
    pathname: "/api/reviews/submission/lookup",
    shopDomain: "example.myshopify.com",
  });

  assert.ok(proof);
  const input = { secret, timestamp, method: "POST", pathname: "/api/reviews/submission/lookup", shopDomain: "example.myshopify.com", now };
  assert.equal(verifyInternalAppProxyProof({ ...input, proof }), true);
  assert.equal(verifyInternalAppProxyProof({ ...input, proof: "forged" }), false);
  assert.equal(verifyInternalAppProxyProof({ ...input, timestamp: String(now - 31_000), proof }), false);
});
