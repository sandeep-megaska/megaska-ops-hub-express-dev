import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "./route.ts";

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

function signedRequest(body: string, topic: string, secret: string) {
  const hmac = crypto.createHmac("sha256", secret).update(Buffer.from(body)).digest("base64");
  return new NextRequest("https://app.loopd2c.com/api/webhooks/compliance", {
    method: "POST",
    headers: { "x-shopify-hmac-sha256": hmac, "x-shopify-topic": topic, "x-shopify-shop-domain": "megaskastore.myshopify.com" },
    body,
  });
}

test("rejects a request with an invalid HMAC before dispatching to any topic handler", async () => {
  const restore = withEnv({ SHOPIFY_WEBHOOK_SECRET: "topsecret", SHOPIFY_API_SECRET: undefined });
  const request = new NextRequest("https://app.loopd2c.com/api/webhooks/compliance", {
    method: "POST",
    headers: { "x-shopify-hmac-sha256": "not-the-real-signature", "x-shopify-topic": "shop/redact" },
    body: "{}",
  });
  const response = await POST(request);
  assert.equal(response.status, 401);
  restore();
});

test("rejects a topic outside the three compliance topics this endpoint is registered for", async () => {
  const restore = withEnv({ SHOPIFY_WEBHOOK_SECRET: "topsecret", SHOPIFY_API_SECRET: undefined });
  const response = await POST(signedRequest("{}", "orders/create", "topsecret"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /Unrecognized compliance topic: orders\/create/);
  restore();
});

test("rejects malformed JSON for a recognized compliance topic", async () => {
  const restore = withEnv({ SHOPIFY_WEBHOOK_SECRET: "topsecret", SHOPIFY_API_SECRET: undefined });
  const response = await POST(signedRequest("not json", "shop/redact", "topsecret"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /Invalid JSON body/);
  restore();
});
