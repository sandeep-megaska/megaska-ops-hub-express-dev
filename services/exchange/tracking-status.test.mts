import test from "node:test";
import assert from "node:assert/strict";
import { exchangeShipmentStatus, isFreshMilestone, nextForwardExchangeStatus, nextReverseExchangeStatus } from "./tracking-status.ts";

test("courier states map to shipment states", () => {
  assert.equal(exchangeShipmentStatus("DELIVERED"), "DELIVERED");
  assert.equal(exchangeShipmentStatus("RTO_DELIVERED"), "FAILED");
  assert.equal(exchangeShipmentStatus("DELIVERY_FAILED"), "IN_TRANSIT", "a failed attempt is still on its way");
  assert.equal(exchangeShipmentStatus("PICKED_UP"), "IN_TRANSIT");
  assert.equal(exchangeShipmentStatus("READY_FOR_PICKUP"), "SCHEDULED");
  assert.equal(exchangeShipmentStatus("PROCESSING"), "PENDING");
});

test("a delivered replacement completes the exchange", () => {
  assert.equal(nextForwardExchangeStatus("REPLACEMENT_SHIPPED", "DELIVERED"), "CLOSED");
  assert.equal(nextForwardExchangeStatus("REPLACEMENT_PROCESSING", "DELIVERED"), "CLOSED");
  assert.equal(nextForwardExchangeStatus("REPLACEMENT_PROCESSING", "IN_TRANSIT"), "REPLACEMENT_SHIPPED");
  assert.equal(nextForwardExchangeStatus("REPLACEMENT_SHIPPED", "PENDING"), "REPLACEMENT_SHIPPED");
});

test("a return pickup moves through pickup completed to item received", () => {
  assert.equal(nextReverseExchangeStatus("PICKUP_SCHEDULED", "IN_TRANSIT", "PICKED_UP"), "PICKUP_COMPLETED");
  assert.equal(nextReverseExchangeStatus("PICKUP_SCHEDULED", "DELIVERED", "DELIVERED"), "ITEM_RECEIVED", "returned between two polls");
  assert.equal(nextReverseExchangeStatus("PICKUP_COMPLETED", "DELIVERED", "DELIVERED"), "ITEM_RECEIVED");
  assert.equal(nextReverseExchangeStatus("REPLACEMENT_SHIPPED", "DELIVERED", "DELIVERED"), "REPLACEMENT_SHIPPED", "never moves backwards");
  assert.equal(nextReverseExchangeStatus("PICKUP_SCHEDULED", "SCHEDULED", "READY_FOR_PICKUP"), "PICKUP_SCHEDULED");
});

test("only recent steps message the customer", () => {
  const now = new Date("2026-11-07T00:00:00Z");
  assert.equal(isFreshMilestone(new Date("2026-11-05T12:00:00Z"), now), true);
  assert.equal(isFreshMilestone(new Date("2026-09-15T17:38:38Z"), now), false);
  assert.equal(isFreshMilestone(null, now), true);
});
