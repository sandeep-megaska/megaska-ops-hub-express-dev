import assert from "node:assert/strict";
import test from "node:test";

import { CustomerDashboardError, toCustomerDashboardErrorDto } from "./errors.ts";

test("typed errors preserve public metadata", () => {
  const error = new CustomerDashboardError({ code: "SESSION_REQUIRED", message: "Session token is required.", status: 401, retryable: false });
  assert.equal(error.code, "SESSION_REQUIRED");
  assert.equal(error.status, 401);
  assert.equal(error.retryable, false);
  assert.deepEqual(toCustomerDashboardErrorDto(error), { version: "dashboard.error.v1", code: "SESSION_REQUIRED", message: "Session token is required.", retryable: false });
});

test("unknown errors map to safe generic dto", () => {
  const dto = toCustomerDashboardErrorDto(new Error("Prisma SQL Shopify stack trace secret"));
  assert.equal(dto.version, "dashboard.error.v1");
  assert.equal(dto.code, "DASHBOARD_UNAVAILABLE");
  assert.equal(dto.retryable, true);
  assert.equal(dto.message.includes("Prisma"), false);
  assert.equal(dto.message.includes("SQL"), false);
  assert.equal(dto.message.includes("Shopify"), false);
});
