import assert from "node:assert/strict";
import test from "node:test";
import { loadCustomerRequests, refundText, requestFromRow, requestStatusText } from "./customer-requests.ts";
import { buildSystemPrompt } from "./policy.ts";

const row = (overrides: Record<string, unknown> = {}) => ({
  requestType: "EXCHANGE", status: "PICKUP_SCHEDULED", orderNumber: "1042", requestedAt: new Date("2026-10-23T06:00:00Z"),
  items: [{ productTitle: "Swim dress", currentSize: "M", requestedSize: "L", quantity: 1 }],
  shipments: [{ direction: "REVERSE_PICKUP", awb: "123", trackingUrl: "https://track.example/123", status: "SCHEDULED" }, { direction: "FORWARD_REPLACEMENT", awb: null, trackingUrl: null, status: "NOT_STARTED" }],
  refundRequests: [],
  ...overrides,
});

test("an exchange reads as its step, sizes, pickup tracking", () => {
  assert.deepEqual(requestFromRow(row()), { kind: "exchange", order: "#1042", requestedOn: "23 Oct", status: "Reverse pickup scheduled", items: "Swim dress (size M → L)", pickup: "scheduled | AWB 123 | https://track.example/123", replacement: null, refund: null });
});

test("cancellations, issues and refunds read plainly", () => {
  assert.equal(requestStatusText("CANCELLATION", "CLOSED"), "Order cancelled");
  assert.equal(requestStatusText("CANCELLATION", "OPEN"), "Cancellation received, being reviewed by the team");
  assert.equal(requestStatusText("ISSUE", "APPROVED"), "Issue report approved");
  assert.equal(requestStatusText("ISSUE", "REJECTED"), "Issue report not accepted");
  assert.equal(refundText({ status: "PAID", amount: 119500, currency: "INR" }), "₹1,195 refunded");
  assert.equal(refundText({ status: "DETAILS_PENDING", amount: 119550, currency: "INR" }), "₹1,195.50 refund waiting for the customer's bank or UPI details");
  assert.equal(refundText({ status: "NOT_REQUIRED", amount: 1, currency: "INR", method: "COD" }), "no refund needed (cash on delivery)");
  assert.equal(refundText({ status: "PAYOUT_PENDING", amount: 1, currency: "INR" }), "refund payment being sent");
  const cancelled = requestFromRow(row({ requestType: "CANCELLATION", status: "CLOSED", orderNumber: "#1050", shipments: [], refundRequests: [{ status: "PAID", amount: 89900, currency: "INR", method: "PREPAID" }] }));
  assert.deepEqual([cancelled.kind, cancelled.order, cancelled.status, cancelled.refund, cancelled.items], ["cancellation", "#1050", "Order cancelled", "₹899 refunded", "Swim dress"]);
});

test("requests are looked up for this shop by the number's last 10 digits, recent ones only", async () => {
  type Where = { shopId: string; OR: unknown; requestedAt: { gte: Date } };
  let where = null as unknown as Where;
  const db = { orderActionRequest: { findMany: async (args: { where: Where }) => { where = args.where; return [row()]; } } };
  const now = new Date("2026-11-06T12:00:00Z");
  const found = await loadCustomerRequests("shop-1", "919539180257", now, db as never);
  assert.equal(found.length, 1);
  assert.equal(where.shopId, "shop-1");
  assert.deepEqual(where.OR, [{ customerPhoneSnapshot: { endsWith: "9539180257" } }, { customerProfile: { phoneE164: { endsWith: "9539180257" } } }]);
  assert.equal(where.requestedAt.gte.toISOString(), new Date(now.getTime() - 120 * 86_400_000).toISOString());
  assert.deepEqual(await loadCustomerRequests("shop-1", "12345", now, db as never), []);
});

test("the assistant answers status questions from REQUESTS, and still hands new requests to the team", () => {
  const prompt = buildSystemPrompt("Megaska");
  assert.match(prompt, /Status of an existing request.*answer from it.*intent request_status with needs_human false/s);
  assert.match(prompt, /"request_status"/);
  assert.match(prompt, /asking for a NEW refund, return, exchange or cancellation, or a change to an existing request/);
});
