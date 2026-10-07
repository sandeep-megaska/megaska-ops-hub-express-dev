/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { dueShippingUpdate, runWhatsAppShippingUpdates, SHIPPING_UPDATE_SENT_EVENT, withinSendingHours } from "./whatsapp-shipping-updates.ts";

const H = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-07T11:00:00Z"); // 4:30 pm IST
const iso = (offsetHours: number) => new Date(NOW + offsetHours * H).toISOString();
const order = (events: Array<[string, number]>, overrides: any = {}) => ({
  id: "gid://shopify/Order/9", name: "522407", cancelledAt: null, paymentGatewayNames: ["Cash on Delivery (COD)"],
  totalOutstandingSet: { shopMoney: { amount: "1195.0", currencyCode: "INR" } },
  shippingAddress: { firstName: "Asha", phone: "9876543210" }, customer: null, customAttributes: [],
  fulfillments: [{ id: "f1", createdAt: iso(-30), status: "SUCCESS", deliveredAt: null, trackingInfo: [{ company: "Delhivery", number: "1704", url: "https://www.delhivery.com/track/package/1704" }], events: { nodes: events.map(([status, h]) => ({ status, happenedAt: iso(h) })) } }],
  ...overrides,
});

test("picked up today: shipped with courier and tracking link", () => {
  assert.deepEqual(dueShippingUpdate(order([["CONFIRMED", -5], ["IN_TRANSIT", -3]]), [], NOW), { step: "shipped", key: "shipped", variables: ["Asha", "522407", "Delhivery", "https://www.delhivery.com/track/package/1704"] });
  assert.equal(dueShippingUpdate(order([["CONFIRMED", -5]]), [], NOW), null, "label only, not picked up");
  assert.equal(dueShippingUpdate(order([["IN_TRANSIT", -3]]), [{ step: "shipped", key: "shipped" }], NOW), null, "sent once");
  assert.equal(dueShippingUpdate(order([["IN_TRANSIT", -30]]), [], NOW), null, "not announced late");
});

test("out for delivery tells a COD customer the amount; a prepaid one that nothing is due", () => {
  const cod = dueShippingUpdate(order([["IN_TRANSIT", -40], ["OUT_FOR_DELIVERY", -2]]), [], NOW);
  assert.equal(cod?.step, "out_for_delivery");
  assert.deepEqual(cod?.variables, ["Asha", "522407", "₹1,195 (Cash on Delivery)"]);
  const prepaid = dueShippingUpdate(order([["IN_TRANSIT", -40], ["OUT_FOR_DELIVERY", -2]], { paymentGatewayNames: ["Razorpay Secure"], totalOutstandingSet: { shopMoney: { amount: "0.0" } } }), [], NOW);
  assert.equal(prepaid?.variables[2], "nothing, it's already paid");
});

test("out for delivery then back in transit is a failed attempt (real pattern: two attempts)", () => {
  const twoAttempts = order([["IN_TRANSIT", -100], ["OUT_FOR_DELIVERY", -28], ["IN_TRANSIT", -21], ["OUT_FOR_DELIVERY", -4], ["IN_TRANSIT", -1]]);
  const first = dueShippingUpdate(twoAttempts, [{ step: "delivery_attempt_failed", key: iso(-28) }], NOW);
  assert.equal(first?.step, "delivery_attempt_failed");
  assert.equal(first?.key, iso(-4));
  assert.equal(dueShippingUpdate(twoAttempts, [{ step: "delivery_attempt_failed", key: iso(-28) }, { step: "delivery_attempt_failed", key: iso(-4) }], NOW), null);
  assert.equal(dueShippingUpdate(twoAttempts, [{ step: "delivery_attempt_failed", key: "a" }, { step: "delivery_attempt_failed", key: "b" }], NOW), null, "at most two failed-attempt messages");
});

test("delivered wins over anything pending and is sent once", () => {
  const delivered = order([["IN_TRANSIT", -50], ["OUT_FOR_DELIVERY", -6], ["DELIVERED", -1]], { fulfillments: [{ ...order([]).fulfillments[0], deliveredAt: iso(-1), events: { nodes: [{ status: "IN_TRANSIT", happenedAt: iso(-50) }, { status: "OUT_FOR_DELIVERY", happenedAt: iso(-6) }, { status: "DELIVERED", happenedAt: iso(-1) }] } }] });
  assert.deepEqual(dueShippingUpdate(delivered, [], NOW), { step: "delivered", key: "delivered", variables: ["Asha", "522407"] });
  assert.equal(dueShippingUpdate(delivered, [{ step: "delivered", key: "delivered" }], NOW), null);
});

test("cancelled orders and fulfillments without tracking get nothing", () => {
  assert.equal(dueShippingUpdate(order([["IN_TRANSIT", -1]], { cancelledAt: iso(-2) }), [], NOW), null);
  assert.equal(dueShippingUpdate(order([["IN_TRANSIT", -1]], { fulfillments: [{ status: "SUCCESS", trackingInfo: [], events: { nodes: [] } }] }), [], NOW), null);
});

test("sending hours are 8 am to 9 pm IST", () => {
  assert.equal(withinSendingHours(new Date("2026-10-07T02:29:00Z")), false); // 7:59 IST
  assert.equal(withinSendingHours(new Date("2026-10-07T02:30:00Z")), true); // 8:00 IST
  assert.equal(withinSendingHours(new Date("2026-10-07T15:29:00Z")), true); // 20:59 IST
  assert.equal(withinSendingHours(new Date("2026-10-07T15:30:00Z")), false); // 21:00 IST
});

test("run sends one update per order, records it, and never repeats it", async () => {
  const events: any[] = [];
  const db: any = {
    shop: { findMany: async () => [{ id: "shop-1", shopDomain: "shop.myshopify.com" }] },
    auditEvent: { findMany: async () => events, create: async ({ data }: any) => { events.push({ ...data, createdAt: new Date(NOW) }); } },
  };
  const sends: any[] = [];
  const deps: any = {
    db, listAccounts: async () => [{ shopId: "shop-1" }], senderFor: () => ({ phoneNumberId: "111", languageCode: "en" }), isOptedOut: async () => false,
    graphql: async () => ({ orders: { nodes: [order([["IN_TRANSIT", -40], ["OUT_FOR_DELIVERY", -2]])], pageInfo: { hasNextPage: false } } }),
    sendTemplate: async (input: any) => { sends.push(input); return { success: true, messageId: "wamid.1" }; },
  };
  const summary = await runWhatsAppShippingUpdates({ now: new Date(NOW) }, deps);
  assert.equal(summary.sent.out_for_delivery, 1);
  assert.equal(sends[0].templateName, "order_out_for_delivery");
  assert.equal(sends[0].toPhone, "919876543210");
  assert.equal(events[0].eventType, SHIPPING_UPDATE_SENT_EVENT);
  assert.equal((await runWhatsAppShippingUpdates({ now: new Date(NOW + 15 * 60 * 1000) }, deps)).sent.out_for_delivery, 0);
  assert.equal((await runWhatsAppShippingUpdates({ now: new Date("2026-10-07T17:00:00Z") }, deps)).skippedQuietHours, true);
});
