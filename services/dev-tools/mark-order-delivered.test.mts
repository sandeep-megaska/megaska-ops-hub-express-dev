import test from "node:test";
import assert from "node:assert/strict";
import { assertDevelopmentDeliveryHelperEnabled, markOrderDeliveredForDevelopment } from "./mark-order-delivered.ts";
import { isOrderDeliveredForReview } from "../orders/canonical-delivery.ts";
import { getRequestWindowExpiresAt } from "../exchange/deadlines.ts";

test("guard requires the flag and a non-production deployment", () => {
  assert.throws(() => assertDevelopmentDeliveryHelperEnabled({ NODE_ENV: "development" }), /DEV_HELPER_DISABLED/);
  assert.throws(() => assertDevelopmentDeliveryHelperEnabled({ LOOPDESK_DEV_DELIVERY_HELPER_ENABLED: "false", VERCEL_ENV: "preview" }), /DEV_HELPER_DISABLED/);
  assert.throws(() => assertDevelopmentDeliveryHelperEnabled({ LOOPDESK_DEV_DELIVERY_HELPER_ENABLED: "true", VERCEL_ENV: "production", NODE_ENV: "development" }), /DEV_HELPER_NOT_ALLOWED/);
  assert.doesNotThrow(() => assertDevelopmentDeliveryHelperEnabled({ LOOPDESK_DEV_DELIVERY_HELPER_ENABLED: "true", VERCEL_ENV: "preview", NODE_ENV: "production" }));
  assert.doesNotThrow(() => assertDevelopmentDeliveryHelperEnabled({ LOOPDESK_DEV_DELIVERY_HELPER_ENABLED: "true", NODE_ENV: "development" }));
});

function dependencies(order: any, transitionCalls: any[]) {
  return {
    env: { LOOPDESK_DEV_DELIVERY_HELPER_ENABLED: "true", VERCEL_ENV: "preview", NODE_ENV: "production" },
    db: { shop: { findUnique: async () => ({ id: "shop-1" }) }, megaskaOrder: { findFirst: async () => order } },
    transition: async (input: any) => {
      transitionCalls.push(input);
      Object.assign(order, { status: "DELIVERED", deliveredAt: new Date(input.deliveredAt), deliverySource: input.source });
      return order;
    },
    log: () => undefined,
  };
}

test("updates the review canonical state and its shared request-window clock", async () => {
  const order = { id: "order-1", shopId: "shop-1", shopifyOrderName: "#1027", status: "PROCESSING", deliveredAt: null };
  const calls: any[] = [];
  const result = await markOrderDeliveredForDevelopment({ shopId: "shop-1", orderId: "order-1", deliveredAt: new Date("2026-07-18T12:00:00Z") }, dependencies(order, calls) as any);
  assert.equal(result.deliveryStatus, "DELIVERED");
  assert.equal(isOrderDeliveredForReview(order), true);
  assert.equal(getRequestWindowExpiresAt(order.deliveredAt)?.toISOString(), "2026-07-20T12:00:00.000Z");
  assert.equal(calls[0].source, "MANUAL");
  assert.equal(result.automationsExecuted, false);
});

test("is idempotent and preserves a genuine deliveredAt", async () => {
  const deliveredAt = new Date("2026-07-17T12:00:00Z");
  const order = { id: "order-1", shopId: "shop-1", shopifyOrderName: "#1027", status: "DELIVERED", deliveredAt };
  const calls: any[] = [];
  const result = await markOrderDeliveredForDevelopment({ shopId: "shop-1", orderId: "order-1", deliveredAt: new Date("2026-07-18T12:00:00Z") }, dependencies(order, calls) as any);
  assert.equal(result.alreadyDelivered, true);
  assert.equal(result.deliveredAt, deliveredAt);
  assert.deepEqual(result.updatedRecords, []);
  assert.equal(calls.length, 0);
});

test("tenant mismatch is not found and automations cannot run", async () => {
  const deps = dependencies(null, []);
  await assert.rejects(() => markOrderDeliveredForDevelopment({ shopId: "shop-1", orderId: "other-shop-order" }, deps as any), /ORDER_NOT_FOUND/);
  await assert.rejects(() => markOrderDeliveredForDevelopment({ shopId: "shop-1", orderId: "order-1", runDeliveryAutomations: true }, deps as any), /INVALID_INPUT/);
});
