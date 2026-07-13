import assert from "node:assert/strict";
import test from "node:test";

import { resolveCustomerDashboardContext, resetCustomerDashboardContextDependenciesForTest, setCustomerDashboardContextDependenciesForTest } from "./context.ts";
import { CustomerDashboardError } from "./errors.ts";

const req = {} as never;
const fixedNow = new Date("2026-07-13T00:00:00.000Z");

function setup(overrides = {}) {
  const updates: unknown[] = [];
  setCustomerDashboardContextDependenciesForTest({
    requireShopFromRequest: async () => ({ id: "shop-1", shopDomain: "example.myshopify.com" }),
    getSessionTokenFromRequest: () => "token",
    hashSessionToken: (token: string) => `hashed:${token}`,
    now: () => fixedNow,
    authSession: {
      findFirst: async () => ({ id: "session-1", customerProfileId: "cust-1", customer: { id: "cust-1", shopId: "shop-1" } }),
      update: async (args: unknown) => { updates.push(args); return args; },
    },
    ...overrides,
  });
  return { updates };
}

test.afterEach(() => resetCustomerDashboardContextDependenciesForTest());

test("missing token maps to SESSION_REQUIRED", async () => {
  setup({ getSessionTokenFromRequest: () => "" });
  await assert.rejects(resolveCustomerDashboardContext(req), (error) => error instanceof CustomerDashboardError && error.code === "SESSION_REQUIRED" && error.status === 401);
});

test("expired session maps to SESSION_EXPIRED", async () => {
  setup({ authSession: { findFirst: async () => null, update: async () => null } });
  await assert.rejects(resolveCustomerDashboardContext(req), (error) => error instanceof CustomerDashboardError && error.code === "SESSION_EXPIRED" && error.status === 401);
});

test("revoked session is not returned by filtered query", async () => {
  let query: { where: { revokedAt?: unknown; expiresAt?: unknown } };
  setup({ authSession: { findFirst: async (args: unknown) => { query = args; return null; }, update: async () => null } });
  await assert.rejects(resolveCustomerDashboardContext(req), (error) => error instanceof CustomerDashboardError && error.code === "SESSION_EXPIRED");
  assert.equal(query.where.revokedAt, null);
  assert.deepEqual(query.where.expiresAt, { gt: fixedNow });
});

test("valid session returns trusted context and updates lastSeenAt", async () => {
  const { updates } = setup();
  const context = await resolveCustomerDashboardContext(req);
  assert.deepEqual(context, { shopId: "shop-1", shopDomain: "example.myshopify.com", customerProfileId: "cust-1", sessionId: "session-1", now: fixedNow });
  assert.deepEqual(updates, [{ where: { id: "session-1" }, data: { lastSeenAt: fixedNow } }]);
});

test("missing customer maps to CUSTOMER_NOT_FOUND", async () => {
  setup({ authSession: { findFirst: async () => ({ id: "session-1", customerProfileId: "cust-1", customer: null }), update: async () => null } });
  await assert.rejects(resolveCustomerDashboardContext(req), (error) => error instanceof CustomerDashboardError && error.code === "CUSTOMER_NOT_FOUND" && error.status === 404);
});

test("shop resolution failure maps to SHOP_REQUIRED", async () => {
  setup({ requireShopFromRequest: async () => { throw new Error("missing shop"); } });
  await assert.rejects(resolveCustomerDashboardContext(req), (error) => error instanceof CustomerDashboardError && error.code === "SHOP_REQUIRED" && error.status === 400);
});
