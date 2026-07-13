import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { buildDashboardTrackingDto, buildShopifyFallbackTracking, findTrustedDeliveredAt, loadDashboardTrackingSnapshots, resetDashboardTrackingDependenciesForTest, selectDashboardTracking, setDashboardTrackingDependenciesForTest } from "./tracking.ts";

const context = { shopId: "shop-1", shopDomain: "s.myshopify.com", customerProfileId: "cust-1", sessionId: "sess-1" };
const order = (n, f = []) => ({ id: `gid://Order/${n}`, shopifyOrderId: null, orderNumber: n, createdAt: null, processedAt: null, fulfilledAt: null, deliveredAt: null, currency: "INR", totalPaise: 0, subtotalPaise: null, discountPaise: 0, shippingPaise: 0, taxPaise: null, financialStatus: "PAID", fulfillmentStatus: "FULFILLED", items: [], fulfillments: f });
afterEach(() => resetDashboardTrackingDependenciesForTest());

test("empty order list performs no database query", async () => {
  let calls = 0;
  setDashboardTrackingDependenciesForTest({ megaskaOrder: { findMany: async () => { calls++; return []; } } });
  const result = await loadDashboardTrackingSnapshots({ context, orders: [] });
  assert.equal(result.size, 0); assert.equal(calls, 0);
});

test("order numbers are normalized/deduplicated and tracking query is scoped and batched", async () => {
  let args;
  setDashboardTrackingDependenciesForTest({ megaskaOrder: { findMany: async (a) => { args = a; return [{ shopifyOrderName: "#1001", status: "IN_TRANSIT", statusUpdatedAt: new Date("2026-01-03T00:00:00Z"), shipments: [{ id: "ship-1", provider: "DELHIVERY", awb: "AWB1", trackingUrl: "https://t", normalizedStatus: "IN_TRANSIT", statusUpdatedAt: new Date("2026-01-03T00:00:00Z"), metadata: { mock: true }, events: [{ id: "evt-1", normalizedStatus: "IN_TRANSIT", occurredAt: new Date("2026-01-02T00:00:00Z"), description: "Moved", location: "Delhi", metadata: { mock: true } }] }] }]; } } });
  const result = await loadDashboardTrackingSnapshots({ context, orders: [order(" #1001 "), order("#1001"), order(" ")] });
  assert.deepEqual(args.where, { shopId: "shop-1", customerProfileId: "cust-1", shopifyOrderName: { in: ["#1001"] } });
  assert.equal(args.include.shipments.include.events.orderBy.occurredAt, "desc");
  assert.equal(args.include.shipments.include.events.take, 8);
  assert.equal(result.get("#1001").shipments[0].awb, "AWB1");
  assert.equal(result.get("#1001").shipments[0].isMock, true);
});

test("tracking source precedence covers internal, fallback, retained internal, and none", () => {
  const internalAwb = { available: true, source: "LOOPDESK_SHIPMENT", summary: { statusCode: "IN_TRANSIT", statusLabel: "In transit", lastUpdatedAt: null, message: null }, shipments: [{ id: "s", direction: "FORWARD", carrier: null, awb: "A", trackingUrl: null, statusCode: "IN_TRANSIT", statusLabel: "In transit", lastUpdatedAt: null, isMock: false, timeline: [] }] };
  const internalNoAwb = { ...internalAwb, shipments: [{ ...internalAwb.shipments[0], awb: null, trackingUrl: null }] };
  const fallback = { ...internalAwb, source: "SHOPIFY_FULFILLMENT", shipments: [{ ...internalAwb.shipments[0], awb: "S" }] };
  assert.equal(selectDashboardTracking({ internalTracking: internalAwb, shopifyFallback: fallback }).source, "LOOPDESK_SHIPMENT");
  assert.equal(selectDashboardTracking({ internalTracking: null, shopifyFallback: fallback }).source, "SHOPIFY_FULFILLMENT");
  assert.equal(selectDashboardTracking({ internalTracking: internalNoAwb, shopifyFallback: fallback }).source, "SHOPIFY_FULFILLMENT");
  assert.equal(selectDashboardTracking({ internalTracking: internalNoAwb, shopifyFallback: null }).source, "LOOPDESK_SHIPMENT");
  assert.equal(selectDashboardTracking({ internalTracking: null, shopifyFallback: null }).source, "NONE");
});

test("Shopify fallback ignores empty tracking, preserves fields, events, and delivery", () => {
  const fallback = buildShopifyFallbackTracking(order("#1", [{ id: "ful-1", status: "SUCCESS", createdAt: "2026-01-01T00:00:00Z", deliveredAt: "2026-01-02T00:00:00Z", trackingInfo: [{ company: "BlueDart", number: "AWB", url: "https://track" }, { company: " ", number: "", url: null }] }]));
  assert.equal(fallback.shipments.length, 1);
  assert.equal(fallback.source, "SHOPIFY_FULFILLMENT");
  assert.equal(fallback.shipments[0].carrier, "BlueDart"); assert.equal(fallback.shipments[0].awb, "AWB"); assert.equal(fallback.shipments[0].trackingUrl, "https://track");
  assert.deepEqual(fallback.shipments[0].timeline.map((e) => e.statusCode), ["SUCCESS", "DELIVERED"]);
  assert.equal(buildShopifyFallbackTracking(order("#2", [{ id: "f", status: null, createdAt: null, deliveredAt: null, trackingInfo: [{ company: "", number: "", url: "" }] }])), null);
});

test("DTO serializes dates and keeps mock flags internal", () => {
  const dto = buildDashboardTrackingDto({ available: true, source: "LOOPDESK_SHIPMENT", summary: { statusCode: "delivered", statusLabel: "Delivered", lastUpdatedAt: new Date("2026-01-02T00:00:00Z"), message: null }, shipments: [{ id: "s", direction: "FORWARD", carrier: null, awb: "A", trackingUrl: null, statusCode: "delivered", statusLabel: "Delivered", lastUpdatedAt: new Date("2026-01-02T00:00:00Z"), isMock: true, timeline: [{ id: "e", statusCode: "delivered", statusLabel: "Delivered", occurredAt: new Date("2026-01-02T00:00:00Z"), description: null, location: null, isMock: true }] }] });
  assert.equal(dto.summary.lastUpdatedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(dto.shipments[0].timeline[0].occurredAt, "2026-01-02T00:00:00.000Z");
  assert.equal("isMock" in dto.shipments[0], false);
});

test("trusted delivered timestamp prefers Shopify then latest shipment delivery", () => {
  const tracking = { available: true, source: "LOOPDESK_SHIPMENT", summary: { statusCode: "DELIVERED", statusLabel: "Delivered", lastUpdatedAt: null, message: null }, shipments: [{ id: "s1", direction: "FORWARD", carrier: null, awb: null, trackingUrl: null, statusCode: "DELIVERED", statusLabel: "Delivered", lastUpdatedAt: "2026-01-01T00:00:00Z", isMock: false, timeline: [{ id: "e", statusCode: "DELIVERED", statusLabel: "Delivered", occurredAt: "2026-01-03T00:00:00Z", description: null, location: null, isMock: false }] }] };
  assert.equal(findTrustedDeliveredAt({ shopifyDeliveredAt: "2026-02-01T00:00:00Z", tracking }), "2026-02-01T00:00:00Z");
  assert.equal(findTrustedDeliveredAt({ shopifyDeliveredAt: null, tracking }).toISOString(), "2026-01-03T00:00:00.000Z");
});
