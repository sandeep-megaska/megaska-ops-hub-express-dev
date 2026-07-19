import assert from "node:assert/strict";
import test from "node:test";
import { CUSTOMER_IDENTITY_INTEGRITY_CHECK_NAMES, verifyCustomerIdentityIntegrity } from "./customer-identity-integrity.ts";

test("rejects an unscoped integrity scan", async () => {
  const db = { async $queryRawUnsafe<T>(): Promise<T> { return [] as T; } };
  await assert.rejects(() => verifyCustomerIdentityIntegrity(db, "  "), /shopId is required/);
});

test("runs every check with the same tenant scope and reports redacted samples", async () => {
  const calls: unknown[][] = [];
  const db = {
    async $queryRawUnsafe<T>(_sql: string, ...values: unknown[]): Promise<T> {
      calls.push(values);
      return (calls.length === 2 ? [{ ids: Array.from({ length: 25 }, (_, i) => `profile-${i}`) }] : []) as T;
    },
  };
  const result = await verifyCustomerIdentityIntegrity(db, " shop-1 ");
  assert.equal(calls.length, CUSTOMER_IDENTITY_INTEGRITY_CHECK_NAMES.length);
  assert.ok(calls.every(([shopId]) => shopId === "shop-1"));
  assert.deepEqual(result, [{
    check: "duplicate_verified_phone_identity",
    count: 25,
    sampleIds: Array.from({ length: 25 }, (_, i) => `profile-${i}`).sort().slice(0, 20),
  }]);
});
