import assert from "node:assert/strict";
import test from "node:test";
import { checkMetaWebhookChallenge } from "./meta-cloud-api.ts";

function params(query: Record<string, string>) {
  return new URLSearchParams(query);
}

test("webhook challenge reports why verification failed", () => {
  const previous = process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN;
  try {
    delete process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN;
    assert.deepEqual(checkMetaWebhookChallenge(params({ "hub.mode": "subscribe", "hub.verify_token": "abc", "hub.challenge": "1" })), { ok: false, reason: "verify_token_not_configured" });

    process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN = " abc ";
    assert.deepEqual(checkMetaWebhookChallenge(params({ "hub.verify_token": "abc", "hub.challenge": "1" })), { ok: false, reason: "not_a_subscribe_request" });
    assert.deepEqual(checkMetaWebhookChallenge(params({ "hub.mode": "subscribe", "hub.verify_token": "abd", "hub.challenge": "1" })), { ok: false, reason: "verify_token_mismatch" });
    assert.deepEqual(checkMetaWebhookChallenge(params({ "hub.mode": "subscribe", "hub.verify_token": "abc", "hub.challenge": "12345" })), { ok: true, challenge: "12345" });
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN;
    else process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN = previous;
  }
});
