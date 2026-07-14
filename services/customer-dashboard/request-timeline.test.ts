import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerRequestTimeline, normalizeCustomerRequestStatus } from "./request-timeline.ts";

const d = (value: string) => new Date(value);
const baseCancellation = (over = {}) => ({ id: "can-1", status: "OPEN", requestedAt: d("2026-01-01T00:00:00.000Z"), updatedAt: null, orderAmountSnapshotPaise: null, refundOutcome: { requirementLabel: null, customerExplanation: null, refundStatusCode: null }, blocking: true, ...over });
const baseExchange = (over = {}) => ({ id: "ex-1", status: "APPROVED", requestedAt: d("2026-01-03T00:00:00.000Z"), updatedAt: d("2026-01-04T00:00:00.000Z"), blocking: true, active: true, payment: null, reverseShipment: null, replacementShipment: null, progress: [], ...over });
const baseIssue = (over = {}) => ({ id: "iss-1", status: "UNDER_REVIEW", requestedAt: d("2026-01-02T00:00:00.000Z"), updatedAt: d("2026-01-02T01:00:00.000Z"), blocking: true, ...over });

test("builds an empty timeline", () => assert.deepEqual(buildCustomerRequestTimeline({}), []));

test("maps internal request statuses to customer-safe labels", () => {
  assert.deepEqual(normalizeCustomerRequestStatus("OPEN"), { currentStatus: "OPEN", statusLabel: "Submitted" });
  assert.deepEqual(normalizeCustomerRequestStatus("UNDER_REVIEW"), { currentStatus: "UNDER_REVIEW", statusLabel: "Under Review" });
  assert.deepEqual(normalizeCustomerRequestStatus("REPLACEMENT_SHIPPED"), { currentStatus: "REPLACEMENT_SHIPPED", statusLabel: "Processing" });
});

test("sorts mixed request types newest first and events oldest first", () => {
  const timeline = buildCustomerRequestTimeline({ cancellations: [baseCancellation()], exchanges: [baseExchange()], issues: [baseIssue()] });
  assert.deepEqual(timeline.map((x) => x.requestType), ["EXCHANGE", "ISSUE", "CANCELLATION"]);
  assert.deepEqual(timeline[0].events.map((x) => x.label), ["Submitted", "Approved"]);
});

test("supports multiple requests per type with deterministic ordering", () => {
  const timeline = buildCustomerRequestTimeline({ cancellations: [baseCancellation({ id: "can-b", requestedAt: d("2026-01-05T00:00:00.000Z") }), baseCancellation({ id: "can-a", requestedAt: d("2026-01-05T00:00:00.000Z") })] });
  assert.deepEqual(timeline.map((x) => x.requestId), ["can-a", "can-b"]);
});

test("does not expose merchant-only fields from source records", () => {
  const timeline = buildCustomerRequestTimeline({ issues: [baseIssue({ merchantNotes: "private", staffEmail: "agent@example.com", shopId: "shop-1", customerProfileId: "cust-1" }) as never] });
  const serialized = JSON.stringify(timeline);
  assert.ok(!serialized.includes("private"));
  assert.ok(!serialized.includes("agent@example.com"));
  assert.ok(!serialized.includes("shop-1"));
  assert.ok(!serialized.includes("cust-1"));
});


test("adds one authoritative Store Credit event for COD cancellation refunds", () => {
  const timeline = buildCustomerRequestTimeline({ cancellations: [baseCancellation({ refunds: [{ refundRequestId: "ref-1", requestId: "can-1", method: "COD", status: "PAID", amountPaise: 125000, currency: "INR", createdAt: d("2026-01-02T00:00:00.000Z"), updatedAt: d("2026-01-03T00:00:00.000Z"), paidAt: d("2026-01-03T00:00:00.000Z"), settlement: { type: "STORE_CREDIT", transactionId: "tx-1", transactionType: "COD_REFUND_CREDIT", amountPaise: 125000, currency: "INR", issuedAt: d("2026-01-04T00:00:00.000Z") } }] })] });
  const events = timeline[0].events.filter((e) => e.type === "STORE_CREDIT_ISSUED");
  assert.equal(events.length, 1);
  assert.equal(events[0].label, "Store Credit issued");
  assert.equal(events[0].occurredAt, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(events[0].amount, { amountPaise: 125000, currency: "INR" });
  assert.ok(!JSON.stringify(timeline).includes("Wallet"));
});

test("adds issue-linked Store Credit events only to the issue timeline item", () => {
  const timeline = buildCustomerRequestTimeline({ cancellations: [baseCancellation()], issues: [baseIssue({ refunds: [{ refundRequestId: "ref-issue", requestId: "iss-1", method: "COD", status: "PAID", amountPaise: 500, currency: "INR", createdAt: d("2026-01-02T00:30:00.000Z"), updatedAt: null, paidAt: null, settlement: { type: "STORE_CREDIT", transactionId: "tx-issue", transactionType: "COD_REFUND_CREDIT", amountPaise: 500, currency: "INR", issuedAt: d("2026-01-02T02:00:00.000Z") } }] })] });
  assert.equal(timeline.find((x) => x.requestType === "ISSUE")?.events.some((e) => e.type === "STORE_CREDIT_ISSUED"), true);
  assert.equal(timeline.find((x) => x.requestType === "CANCELLATION")?.events.some((e) => e.type === "STORE_CREDIT_ISSUED"), false);
});

test("does not fabricate Store Credit and describes prepaid refunds safely", () => {
  const timeline = buildCustomerRequestTimeline({ cancellations: [baseCancellation({ refunds: [
    { refundRequestId: "cod-missing", requestId: "can-1", method: "COD", status: "PAID", amountPaise: 100, currency: "INR", createdAt: d("2026-01-02T00:00:00.000Z"), updatedAt: d("2026-01-03T00:00:00.000Z"), paidAt: d("2026-01-03T00:00:00.000Z"), settlement: null },
    { refundRequestId: "prepaid", requestId: "can-1", method: "PREPAID", status: "PAID", amountPaise: 200, currency: "INR", createdAt: d("2026-01-02T01:00:00.000Z"), updatedAt: d("2026-01-04T00:00:00.000Z"), paidAt: d("2026-01-04T00:00:00.000Z"), settlement: { type: "ORIGINAL_PAYMENT_METHOD", completedAt: d("2026-01-04T00:00:00.000Z") } }
  ] })] });
  assert.equal(timeline[0].events.some((e) => e.type === "STORE_CREDIT_ISSUED"), false);
  assert.equal(timeline[0].events.some((e) => e.label === "Refunded to original payment method"), true);
});

test("deduplicates duplicate Store Credit settlement evidence", () => {
  const refund = { refundRequestId: "ref-dup", requestId: "can-1", method: "COD", status: "PAID", amountPaise: 100, currency: "INR", createdAt: d("2026-01-02T00:00:00.000Z"), updatedAt: null, paidAt: null, settlement: { type: "STORE_CREDIT", transactionId: "tx-dup", transactionType: "COD_REFUND_CREDIT", amountPaise: 100, currency: "INR", issuedAt: d("2026-01-03T00:00:00.000Z") } };
  const timeline = buildCustomerRequestTimeline({ cancellations: [baseCancellation({ refunds: [refund, refund] })] });
  assert.equal(timeline[0].events.filter((e) => e.type === "STORE_CREDIT_ISSUED").length, 1);
});
