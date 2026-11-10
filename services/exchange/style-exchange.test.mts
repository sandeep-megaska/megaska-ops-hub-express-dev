import test from "node:test";
import assert from "node:assert/strict";
import { isSettlementAllowed, settlementOptions, styleChangeBlocker, styleDifferencePaise, styleReplacementBlocker } from "./style-exchange.ts";

test("difference over changed items only, per quantity", () => {
  assert.equal(styleDifferencePaise([{ quantity: 1 }]), null, "size-only exchange");
  assert.equal(styleDifferencePaise([{ quantity: 2, replacementVariantId: "v", replacementUnitPricePaise: 179000, originalUnitPricePaise: 148000 }, { quantity: 1 }]), 62000);
  assert.equal(styleDifferencePaise([{ quantity: 1, replacementVariantId: "v", replacementUnitPricePaise: 99900, originalUnitPricePaise: 148000 }]), -48100);
});

test("settlement depends on who owes", () => {
  assert.deepEqual(settlementOptions(500), ["COLLECT"]);
  assert.deepEqual(settlementOptions(-500), ["STORE_CREDIT", "NO_REFUND", "MANUAL_REFUND"]);
  assert.deepEqual(settlementOptions(0), []);
  assert.equal(isSettlementAllowed("STORE_CREDIT", 500), false);
  assert.equal(isSettlementAllowed("NO_REFUND", -500), true);
});

test("style locks once booked or settled; replacement waits for settlement", () => {
  assert.equal(styleChangeBlocker({ status: "PICKUP_COMPLETED" }), null);
  assert.match(styleChangeBlocker({ status: "REPLACEMENT_PROCESSING", forwardAwb: "1" }) ?? "", /already been booked/);
  assert.match(styleChangeBlocker({ status: "ITEM_RECEIVED", stylePaymentPaid: true }) ?? "", /locked/);
  assert.match(styleReplacementBlocker({ difference: 500 }) ?? "", /hasn't paid/);
  assert.equal(styleReplacementBlocker({ difference: 500, settledAt: new Date() }), null);
  assert.match(styleReplacementBlocker({ difference: -500 }) ?? "", /settle/);
  assert.equal(styleReplacementBlocker({ difference: 0 }), null);
  assert.equal(styleReplacementBlocker({ difference: null }), null);
});
