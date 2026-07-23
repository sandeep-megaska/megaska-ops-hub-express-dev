import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifyShopifyWebhookHmac } from "./webhook-hmac.ts";

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
