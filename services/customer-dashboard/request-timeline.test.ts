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
