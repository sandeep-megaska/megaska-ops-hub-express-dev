import test from "node:test";
import assert from "node:assert/strict";
import { earlyReplacementEligibility, returnOutstanding } from "./early-replacement.ts";

test("early replacement only once the return is picked up", () => {
  assert.deepEqual(earlyReplacementEligibility({ status: "PICKUP_COMPLETED", reverseShipment: { status: "IN_TRANSIT", awb: "1" } }), { ok: true });
  assert.deepEqual(earlyReplacementEligibility({ status: "PICKUP_SCHEDULED", reverseShipment: { status: "IN_TRANSIT", awb: "1" } }), { ok: true }, "tracking says picked up");
  assert.equal(earlyReplacementEligibility({ status: "PICKUP_SCHEDULED", reverseShipment: { status: "SCHEDULED", awb: "1" } }).ok, false, "not collected yet");
  assert.equal(earlyReplacementEligibility({ status: "APPROVED", reverseShipment: null }).ok, false);
  assert.equal(earlyReplacementEligibility({ status: "ITEM_RECEIVED", reverseShipment: { status: "DELIVERED" } }).ok, false, "normal flow");
  assert.equal(earlyReplacementEligibility({ status: "PICKUP_COMPLETED", reverseShipment: { status: "FAILED" } }).ok, false);
  assert.equal(earlyReplacementEligibility({ status: "PICKUP_COMPLETED", earlyReplacementAt: new Date(), reverseShipment: { status: "IN_TRANSIT" } }).ok, false);
});

test("return outstanding after an early replacement", () => {
  assert.equal(returnOutstanding({ earlyReplacementAt: new Date(), reverseShipment: { status: "IN_TRANSIT" } }), true);
  assert.equal(returnOutstanding({ earlyReplacementAt: new Date(), reverseShipment: { status: "DELIVERED" } }), false);
  assert.equal(returnOutstanding({ earlyReplacementAt: null, reverseShipment: { status: "IN_TRANSIT" } }), false);
});
