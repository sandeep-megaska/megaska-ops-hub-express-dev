import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { identifyShopifyWebhookSigner } from "./webhook-hmac.ts";
import { decryptShopifyToken, encryptShopifyToken } from "./token-crypto.ts";
import { decryptGiftCardCode, encryptGiftCardCode } from "../store-credit/gift-card-crypto.ts";

const sign = (secret: string, body: Buffer) => crypto.createHmac("sha256", secret).update(body).digest("base64");

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// Moving LoopD2C to a new Shopify app: the old app stays configured in
// SHOPIFY_WEBHOOK_SECRET for a while, and its uninstall / shop/redact must not
// act on the store the new app still serves.
test("webhooks are attributed to this app, another configured app, or nobody", () => {
  const body = Buffer.from(JSON.stringify({ shop_domain: "bigonbuy-fashions.myshopify.com" }));
  withEnv({ SHOPIFY_API_SECRET: "new-app-secret", SHOPIFY_WEBHOOK_SECRET: "old-app-secret,staging-secret" }, () => {
    assert.equal(identifyShopifyWebhookSigner(body, sign("new-app-secret", body)), "this-app");
    assert.equal(identifyShopifyWebhookSigner(body, sign("old-app-secret", body)), "other-app");
    assert.equal(identifyShopifyWebhookSigner(body, sign("staging-secret", body)), "other-app");
    assert.equal(identifyShopifyWebhookSigner(body, sign("attacker", body)), null);
    assert.equal(identifyShopifyWebhookSigner(body, ""), null);
  });
  // The own secret listed in SHOPIFY_WEBHOOK_SECRET too still counts as this app.
  withEnv({ SHOPIFY_API_SECRET: "new-app-secret", SHOPIFY_WEBHOOK_SECRET: "new-app-secret" }, () => {
    assert.equal(identifyShopifyWebhookSigner(body, sign("new-app-secret", body)), "this-app");
  });
});

test("tokens and gift-card codes encrypted under the old app secret stay readable via SHOPIFY_API_SECRET_PREVIOUS", () => {
  let oldToken = "";
  let oldCode = "";
  // Encrypted while the key came from the old app secret (no dedicated key set).
  withEnv({ SHOPIFY_TOKEN_ENCRYPTION_KEY: undefined, TOKEN_ENCRYPTION_KEY: undefined, GIFT_CARD_ENCRYPTION_KEY: undefined, SHOPIFY_API_SECRET: "old-app-secret" }, () => {
    oldToken = encryptShopifyToken("shpat_old") ?? "";
    oldCode = encryptGiftCardCode("ABCD-EFGH-JKLM-NPQR") ?? "";
  });
  withEnv({ SHOPIFY_TOKEN_ENCRYPTION_KEY: undefined, TOKEN_ENCRYPTION_KEY: undefined, GIFT_CARD_ENCRYPTION_KEY: undefined, SHOPIFY_API_SECRET: "new-app-secret", SHOPIFY_API_SECRET_PREVIOUS: undefined }, () => {
    assert.equal(decryptShopifyToken(oldToken), null, "unreadable without the previous secret");
    assert.equal(decryptGiftCardCode(oldCode), null);
  });
  withEnv({ SHOPIFY_TOKEN_ENCRYPTION_KEY: undefined, TOKEN_ENCRYPTION_KEY: undefined, GIFT_CARD_ENCRYPTION_KEY: undefined, SHOPIFY_API_SECRET: "new-app-secret", SHOPIFY_API_SECRET_PREVIOUS: "old-app-secret" }, () => {
    assert.equal(decryptShopifyToken(oldToken), "shpat_old");
    assert.equal(decryptGiftCardCode(oldCode), "ABCD-EFGH-JKLM-NPQR");
    // New values use the current key.
    assert.equal(decryptShopifyToken(encryptShopifyToken("shpat_new")), "shpat_new");
  });
  // With a dedicated encryption key (the expected production setup) the app secret plays no part.
  withEnv({ SHOPIFY_TOKEN_ENCRYPTION_KEY: "dedicated-key", SHOPIFY_API_SECRET: "old-app-secret" }, () => {
    oldToken = encryptShopifyToken("shpat_x") ?? "";
  });
  withEnv({ SHOPIFY_TOKEN_ENCRYPTION_KEY: "dedicated-key", SHOPIFY_API_SECRET: "new-app-secret", SHOPIFY_API_SECRET_PREVIOUS: undefined }, () => {
    assert.equal(decryptShopifyToken(oldToken), "shpat_x");
  });
});
