import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyShopifyWebhook } from "./webhook.ts";
import { webhookResourceId } from "../sync/webhooks.ts";

const secret = "shpss_test_secret";
const body = JSON.stringify({ id: 8680604106888, title: "Swimsuit ₹" });
const sign = (b: string, s = secret) => createHmac("sha256", s).update(b).digest("base64");

test("accepts a correct signature", () => {
  assert.equal(verifyShopifyWebhook(Buffer.from(body), sign(body), secret), true);
});

test("rejects a wrong secret, a tampered body, or a missing header", () => {
  assert.equal(verifyShopifyWebhook(Buffer.from(body), sign(body, "other"), secret), false);
  assert.equal(verifyShopifyWebhook(Buffer.from(body + " "), sign(body), secret), false);
  assert.equal(verifyShopifyWebhook(Buffer.from(body), null, secret), false);
  assert.equal(verifyShopifyWebhook(Buffer.from(body), "not base64!!", secret), false);
});

test("webhookResourceId reads the right field per topic", () => {
  assert.equal(webhookResourceId("products/update", { id: 8680604106888 }), "8680604106888");
  assert.equal(webhookResourceId("inventory_levels/update", { inventory_item_id: 46400340295816 }), "46400340295816");
  assert.equal(webhookResourceId("products/update", {}), undefined);
  assert.equal(webhookResourceId("products/update", { id: "gid://shopify/Product/1" }), undefined);
});
