import test from "node:test";
import assert from "node:assert/strict";

import {
  RAZORPAY_PAYMENT_ID,
  checkFeePayment,
  issueStatusAfterReverseShipment,
  isManualPickupReason,
  mergePickupAddress,
  normalizeOrderNumber,
  statusAfterPickupBooked,
  pickShopifyOrderByName,
  shopifyOrderNameQuery,
} from "./manual-reverse-pickup-rules.ts";

test("booking a pickup moves exchanges to pickup scheduled and issues to approved", () => {
  // Exchange: fee recorded (manually or via link) then booked.
  assert.equal(statusAfterPickupBooked("EXCHANGE", "PAYMENT_RECEIVED"), "PICKUP_SCHEDULED");
  assert.equal(statusAfterPickupBooked("EXCHANGE", "APPROVED"), "PICKUP_SCHEDULED");
  assert.equal(statusAfterPickupBooked("EXCHANGE", "PICKUP_PENDING"), "PICKUP_SCHEDULED");
  // Issue statuses mean different things ("PICKUP_PENDING" = need more info):
  // booking the pickup means "approved, awaiting returned goods".
  assert.equal(statusAfterPickupBooked("ISSUE", "OPEN"), "APPROVED");
  assert.equal(statusAfterPickupBooked("ISSUE", "PICKUP_PENDING"), "APPROVED");
  assert.equal(statusAfterPickupBooked("ISSUE", "PAYMENT_RECEIVED"), "APPROVED");
  assert.equal(statusAfterPickupBooked("ISSUE", "APPROVED"), "APPROVED");
  // Never jumps an issue backwards or out of a terminal state.
  assert.equal(statusAfterPickupBooked("ISSUE", "RETURN_RECEIVED"), "RETURN_RECEIVED");
  assert.equal(statusAfterPickupBooked("ISSUE", "CLOSED"), "CLOSED");
});

test("an issue's return reaching the warehouse marks the goods received", () => {
  assert.equal(issueStatusAfterReverseShipment("APPROVED", "DELIVERED"), "RETURN_RECEIVED");
  assert.equal(issueStatusAfterReverseShipment("APPROVED", "IN_TRANSIT"), "APPROVED");
  assert.equal(issueStatusAfterReverseShipment("APPROVED", "FAILED"), "APPROVED");
  assert.equal(issueStatusAfterReverseShipment("CLOSED", "DELIVERED"), "CLOSED");
});

test("a Razorpay payment settles the fee only when captured, in INR and enough", () => {
  const paid = checkFeePayment({ id: "pay_Nx3kQ9rT2vLm8s", status: "captured", amount: 12000, currency: "INR", created_at: 1763520000 }, 12000);
  assert.equal(paid.ok, true);
  assert.equal(paid.ok && paid.paidAt?.toISOString(), "2025-11-19T02:40:00.000Z");
  assert.equal(checkFeePayment({ id: "pay_x", status: "captured", amount: 15000, currency: "INR" }, 12000).ok, true);

  const cases: Array<[Parameters<typeof checkFeePayment>[0], RegExp]> = [
    [null, /no payment/],
    [{ id: "pay_x", status: "authorized", amount: 12000, currency: "INR" }, /not captured yet/],
    [{ id: "pay_x", status: "failed", amount: 12000, currency: "INR" }, /failed/],
    [{ id: "pay_x", status: "captured", amount: 10000, currency: "INR" }, /₹100\.00, less than the ₹120\.00/],
    [{ id: "pay_x", status: "captured", amount: 12000, currency: "USD" }, /not in INR/],
  ];
  for (const [payment, message] of cases) {
    const result = checkFeePayment(payment, 12000);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, message);
  }
  assert.ok(RAZORPAY_PAYMENT_ID.test("pay_Nx3kQ9rT2vLm8s"));
  assert.ok(!RAZORPAY_PAYMENT_ID.test("plink_Nx3kQ9rT2vLm8s"));
  assert.ok(!RAZORPAY_PAYMENT_ID.test("order_Nx3kQ9rT2vLm8s"));
});

test("the team's address edits replace only the fields they changed", () => {
  const order = { name: "Priya S", phone: "9876543210", address1: "12 MG Road", address2: "", city: "Bengaluru", state: "Karnataka", pin: "560001", country: "India", email: "", source: "shopify" as const };
  const unchanged = mergePickupAddress(order, { city: "  ", pin: "" });
  assert.equal(unchanged?.edited, false);
  assert.equal(unchanged?.city, "Bengaluru");

  // Customer is at her parents' place for Diwali.
  const moved = mergePickupAddress(order, { address1: "4 Lake View", city: "Mysuru", pin: "570001" });
  assert.equal(moved?.edited, true);
  assert.equal(moved?.address1, "4 Lake View");
  assert.equal(moved?.city, "Mysuru");
  assert.equal(moved?.name, "Priya S");
  assert.equal(moved?.source, "shopify");

  // No address on the order: the team's entry is used.
  const typed = mergePickupAddress(null, { name: "Priya", phone: "9876543210", address1: "4 Lake View", city: "Mysuru", state: "Karnataka", pin: "570001" });
  assert.equal(typed?.country, "India");
  assert.equal(typed?.pin, "570001");
  assert.equal(mergePickupAddress(null, null), null);
});

test("order numbers and reasons", () => {
  assert.equal(normalizeOrderNumber(" #522404 "), "522404");
  assert.equal(normalizeOrderNumber("522404"), "522404");
  assert.equal(normalizeOrderNumber(null), "");
  assert.ok(isManualPickupReason("LATE_DELIVERY"));
  assert.ok(!isManualPickupReason("REFUND"));
});

test("an order missing from LoopD2C is found in Shopify by its exact number", () => {
  // Exchange replacement 522574 (for 522488) was never copied into LoopD2C's order list.
  assert.equal(shopifyOrderNameQuery("#522574"), "name:522574 OR name:#522574");
  const nodes = [{ id: "gid://shopify/Order/2", name: "5225740" }, { id: "gid://shopify/Order/1", name: "522574" }];
  assert.equal(pickShopifyOrderByName(nodes, "522574")?.id, "gid://shopify/Order/1");
  assert.equal(pickShopifyOrderByName([{ id: "gid://shopify/Order/3", name: "#1001" }], "1001")?.id, "gid://shopify/Order/3");
  assert.equal(pickShopifyOrderByName([{ id: "gid://shopify/Order/2", name: "5225740" }], "522574"), null);
  assert.equal(pickShopifyOrderByName(null, "522574"), null);
});
