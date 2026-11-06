import assert from "node:assert/strict";
import test from "node:test";
import { refundAmountText, requestUpdateKey, requestUpdateVariables, sendRequestUpdate } from "./request-updates.ts";

test("which steps message the customer", () => {
  assert.equal(requestUpdateKey("CANCELLATION", "CLOSED"), "CANCELLATION_CLOSED");
  assert.equal(requestUpdateKey("CANCELLATION", "APPROVED"), "CANCELLATION_APPROVED");
  assert.equal(requestUpdateKey("CANCELLATION", "REJECTED"), "CANCELLATION_REJECTED");
  assert.equal(requestUpdateKey("CANCELLATION", "OPEN"), null);
  assert.equal(requestUpdateKey("ISSUE", "OPEN"), "ISSUE_OPEN");
  assert.equal(requestUpdateKey("ISSUE", "CLOSED"), "ISSUE_CLOSED");
  assert.equal(requestUpdateKey("ISSUE", "RETURN_RECEIVED"), null);
  assert.equal(requestUpdateKey("EXCHANGE", "APPROVED"), null, "exchanges have their own milestones");
  assert.equal(requestUpdateKey("REFUND", "PAID"), null, "refunds go through notifyRefundPaid");
});

test("variables: first name and order number without #; refund amount from paise", () => {
  assert.deepEqual(requestUpdateVariables({ customerName: "Asha Rao", orderNumber: "#1042" }), ["Asha", "1042"]);
  assert.deepEqual(requestUpdateVariables({ customerName: null, orderNumber: "1042" }), ["there", "1042"]);
  assert.equal(refundAmountText(119500, "INR"), "₹1,195");
  assert.equal(refundAmountText(119550, "INR"), "₹1,195.50");
});

function deps(overrides: { marked?: boolean; sender?: { languageCode: string } | null } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const marks: string[] = [];
  return {
    sent, marks,
    deps: {
      marker: async () => overrides.marked ?? false,
      mark: async (_type: string, _id: string, eventType: string) => { marks.push(eventType); },
      sender: async () => (overrides.sender === undefined ? { languageCode: "en" } : overrides.sender),
      send: async (input: Record<string, unknown>) => { sent.push(input); },
    },
  };
}

test("sends the step's template once, from the shop's own number", async () => {
  const d = deps();
  const result = await sendRequestUpdate({ entityType: "OrderActionRequest", entityId: "r1", shopId: "s1", key: "CANCELLATION_CLOSED", toPhone: "919539180257", variables: ["Asha", "1042"] }, d.deps);
  assert.deepEqual(result, { sent: true });
  assert.equal(d.sent[0].templateName, "order_cancelled");
  assert.deepEqual(d.sent[0].variables, ["Asha", "1042"]);
  assert.equal(d.sent[0].languageCode, "en");
  assert.deepEqual(d.marks, ["request.update_notified.CANCELLATION_CLOSED"]);
});

test("nothing is sent twice, with updates off, or without a phone", async () => {
  const input = { entityType: "OrderActionRequest", entityId: "r1", shopId: "s1", key: "ISSUE_OPEN" as const, toPhone: "919539180257", variables: ["Asha", "1042"] };
  const already = deps({ marked: true });
  assert.deepEqual(await sendRequestUpdate(input, already.deps), { sent: false, reason: "already-notified" });
  const off = deps({ sender: null });
  assert.deepEqual(await sendRequestUpdate(input, off.deps), { sent: false, reason: "updates-off" });
  assert.equal(off.marks.length, 0, "turning updates on later still sends later steps");
  assert.deepEqual(await sendRequestUpdate({ ...input, toPhone: null }, deps().deps), { sent: false, reason: "no-shop-or-phone" });
  assert.equal(already.sent.length + off.sent.length, 0);
});
