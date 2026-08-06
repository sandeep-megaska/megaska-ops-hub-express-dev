import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  verifyShopifyWebhookHmac,
  collectShopifyWebhookSecrets,
  describeShopifyWebhookHmac,
} from "./webhook-hmac.ts";

function withEnv(vars: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return () => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

test("accepts a signature computed with the configured secret", () => {
  const restore = withEnv({ SHOPIFY_WEBHOOK_SECRET: "topsecret", SHOPIFY_API_SECRET: undefined });
  const body = Buffer.from(JSON.stringify({ shop_domain: "demo.myshopify.com" }));
  const hmac = crypto.createHmac("sha256", "topsecret").update(body).digest("base64");
  assert.equal(verifyShopifyWebhookHmac(body, hmac), true);
  restore();
});

test("falls back to SHOPIFY_API_SECRET when no dedicated webhook secret is configured", () => {
  const restore = withEnv({ SHOPIFY_WEBHOOK_SECRET: undefined, SHOPIFY_API_SECRET: "apisecret" });
  const body = Buffer.from("payload");
  const hmac = crypto.createHmac("sha256", "apisecret").update(body).digest("base64");
  assert.equal(verifyShopifyWebhookHmac(body, hmac), true);
  restore();
});

test("rejects a wrong signature, an empty signature, and a missing secret", () => {
  const restore = withEnv({ SHOPIFY_WEBHOOK_SECRET: "topsecret", SHOPIFY_API_SECRET: undefined });
  const body = Buffer.from("payload");
  assert.equal(verifyShopifyWebhookHmac(body, "not-the-real-signature"), false);
  assert.equal(verifyShopifyWebhookHmac(body, ""), false);
  restore();

  const restoreNoSecret = withEnv({ SHOPIFY_WEBHOOK_SECRET: undefined, SHOPIFY_API_SECRET: undefined });
  const hmac = crypto.createHmac("sha256", "irrelevant").update(body).digest("base64");
  assert.equal(verifyShopifyWebhookHmac(body, hmac), false);
  restoreNoSecret();
});

test("rejects a tampered payload even with a structurally valid signature", () => {
  const restore = withEnv({ SHOPIFY_WEBHOOK_SECRET: "topsecret", SHOPIFY_API_SECRET: undefined });
  const original = Buffer.from("original payload");
  const tampered = Buffer.from("tampered payload");
  const hmac = crypto.createHmac("sha256", "topsecret").update(original).digest("base64");
  assert.equal(verifyShopifyWebhookHmac(tampered, hmac), false);
  restore();
});

test("accepts a signature from ANY app secret in a multi-secret list", () => {
  // Three apps installed across stores that point at one deployment; each signs
  // with its own client secret. All three are supplied via SHOPIFY_WEBHOOK_SECRET.
  const restore = withEnv({
    SHOPIFY_WEBHOOK_SECRET: "prod-secret, staging-secret ops-secret",
    SHOPIFY_API_SECRET: undefined,
  });
  const body = Buffer.from(JSON.stringify({ id: 123 }));
  for (const secret of ["prod-secret", "staging-secret", "ops-secret"]) {
    const hmac = crypto.createHmac("sha256", secret).update(body).digest("base64");
    assert.equal(verifyShopifyWebhookHmac(body, hmac), true, `secret ${secret} should verify`);
  }
  // A secret NOT in the list is still rejected.
  const rogue = crypto.createHmac("sha256", "unknown-app").update(body).digest("base64");
  assert.equal(verifyShopifyWebhookHmac(body, rogue), false);
  restore();
});

test("collectShopifyWebhookSecrets splits, trims, and dedupes across both env vars", () => {
  const restore = withEnv({
    SHOPIFY_WEBHOOK_SECRET: "a, b;  c\n a",
    SHOPIFY_API_SECRET: "b",
  });
  assert.deepEqual(collectShopifyWebhookSecrets(), ["a", "b", "c"]);
  restore();
});

test("describeShopifyWebhookHmac reports non-sensitive breadcrumbs", () => {
  const restore = withEnv({ SHOPIFY_WEBHOOK_SECRET: "s1, s2", SHOPIFY_API_SECRET: undefined });
  const body = Buffer.from("payload-bytes");
  const info = describeShopifyWebhookHmac(body, "sig");
  assert.equal(info.candidateSecretCount, 2);
  assert.equal(info.hasWebhookSecretEnv, true);
  assert.equal(info.hasApiSecretEnv, false);
  assert.equal(info.hmacHeaderPresent, true);
  assert.equal(info.bodyBytes, body.length);
  assert.equal(info.ok, false);
  restore();

  const restoreEmpty = withEnv({ SHOPIFY_WEBHOOK_SECRET: undefined, SHOPIFY_API_SECRET: undefined });
  const noSecret = describeShopifyWebhookHmac(body, "sig");
  assert.equal(noSecret.candidateSecretCount, 0);
  restoreEmpty();
});
