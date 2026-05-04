import test from "node:test";
import assert from "node:assert/strict";
import { __testables } from "./customer-refunds";

test("UPI validation works", () => {
  const valid = __testables.validateSubmission({ rail: "UPI", upiId: "Alice.UPI@YBL" });
  assert.equal("error" in valid, false);
  if (!("error" in valid)) {
    assert.equal(valid.upiId, "alice.upi@ybl");
  }

  const invalid = __testables.validateSubmission({ rail: "UPI", upiId: "badupi" });
  assert.equal("error" in invalid, true);
});

test("bank account confirmation mismatch fails", () => {
  const result = __testables.validateSubmission({
    rail: "BANK",
    accountHolderName: "User",
    accountNumber: "123456789",
    confirmAccountNumber: "0000000",
    ifsc: "HDFC0001234",
  });

  assert.equal("error" in result, true);
  if ("error" in result) {
    assert.match(result.error, /confirmation/i);
  }
});

test("cannot submit when status is APPROVED/PAID", () => {
  assert.equal(__testables.canSubmit("APPROVED", null), false);
  assert.equal(__testables.canSubmit("PAID", null), false);
});

test("FAILED allows only admin unlock", () => {
  assert.equal(__testables.canSubmit("FAILED", null), false);
  assert.equal(__testables.canSubmit("FAILED", { payoutDetailsUnlocked: false }), false);
  assert.equal(__testables.canSubmit("FAILED", { payoutDetailsUnlocked: true }), true);
});

test("sensitive data masks are never full values", () => {
  const maskedUpi = __testables.maskUpi("alice@ybl");
  assert.notEqual(maskedUpi, "alice@ybl");

  const maskedAccount = __testables.maskAccount("123456789012");
  assert.notEqual(maskedAccount, "123456789012");
  assert.match(maskedAccount, /9012$/);
});
