import assert from "node:assert/strict";
import test from "node:test";
import { offShopifyPaymentsEnabled } from "./off-shopify-payments.ts";
import { settlementOptions, isSettlementAllowed } from "../exchange/style-exchange.ts";

test("off-Shopify payments stay on only for the original store-specific app", () => {
  assert.equal(offShopifyPaymentsEnabled({ SHOPIFY_API_KEY: "91b6af8eff2be76428980364cad07a57" }), true);
  assert.equal(offShopifyPaymentsEnabled({ SHOPIFY_API_KEY: "e16e6f02914ab7a1c1814b1cdb28cfb0" }), false, "public LoopD2C app");
  assert.equal(offShopifyPaymentsEnabled({}), false, "unknown app defaults to the compliant behaviour");
});

test("LOOPD2C_OFF_SHOPIFY_PAYMENTS overrides the client ID", () => {
  assert.equal(offShopifyPaymentsEnabled({ SHOPIFY_API_KEY: "91b6af8eff2be76428980364cad07a57", LOOPD2C_OFF_SHOPIFY_PAYMENTS: "0" }), false);
  assert.equal(offShopifyPaymentsEnabled({ SHOPIFY_API_KEY: "e16e6f02914ab7a1c1814b1cdb28cfb0", LOOPD2C_OFF_SHOPIFY_PAYMENTS: "1" }), true);
});

test("public app style exchanges: Shopify invoice for a dearer style, no store credit", () => {
  assert.deepEqual(settlementOptions(500, false), ["COLLECT"]);
  assert.deepEqual(settlementOptions(-500, false), ["NO_REFUND", "MANUAL_REFUND"]);
  assert.equal(isSettlementAllowed("STORE_CREDIT", -500, false), false);
  assert.equal(isSettlementAllowed("COLLECT", 500, false), true);
  assert.deepEqual(settlementOptions(500), ["COLLECT"], "original app unchanged");
  assert.deepEqual(settlementOptions(-500), ["STORE_CREDIT", "NO_REFUND", "MANUAL_REFUND"]);
});
