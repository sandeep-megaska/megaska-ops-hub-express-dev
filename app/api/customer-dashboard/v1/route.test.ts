import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("canonical dashboard route validates V1 before responding", () => {
  assert.match(source, /validateCustomerDashboardV1\(dashboard\)/);
  assert.match(source, /getCustomerDashboardV1\(context\)/);
});

test("canonical dashboard route applies private cache, vary and nosniff headers to success and errors", () => {
  assert.match(source, /Cache-Control", "private, no-store"/);
  assert.match(source, /Vary", "Origin, Authorization, Access-Control-Request-Headers"/);
  assert.match(source, /X-Content-Type-Options", "nosniff"/);
  assert.match(source, /toCustomerDashboardErrorDto\(normalized\)/);
});
