/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { runWhatsAppSecondOrderNudges, SECOND_ORDER_SENT_EVENT, selectSecondOrderCandidates, withinNudgeHours } from "./whatsapp-second-order.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-08T08:00:00Z"); // 1:30 pm IST
const order = (overrides: any = {}) => ({
  id: "gid://shopify/Order/1", name: "#522400", cancelledAt: null, displayFinancialStatus: "PAID", returnStatus: "NO_RETURN", phone: null,
  customer: { id: "gid://shopify/Customer/7", firstName: "Asha", numberOfOrders: "1", defaultPhoneNumber: null },
  shippingAddress: { firstName: "Asha", phone: "+91 98765 43210" }, customAttributes: [],
  lineItems: { nodes: [{ title: "Frock Style Swim Dress" }] },
  fulfillments: [{ status: "SUCCESS", deliveredAt: new Date(NOW - 22 * DAY).toISOString(), events: { nodes: [] } }],
  ...overrides,
});
const pick = (orders: any[], alreadyNudged: string[] = []) => selectSecondOrderCandidates(orders, { now: NOW, delayDays: 21, alreadyNudged: new Set(alreadyNudged) });

test("a first-time customer delivered three weeks ago is due one nudge", () => {
  assert.deepEqual(pick([order()]).map(({ customerId, phone, firstName, product }) => ({ customerId, phone, firstName, product })), [{ customerId: "gid://shopify/Customer/7", phone: "919876543210", firstName: "Asha", product: "Frock Style Swim Dress" }]);
});

test("repeat buyers, problem orders, wrong timing and earlier nudges are left alone", () => {
  assert.equal(pick([order({ customer: { id: "c", firstName: "A", numberOfOrders: "2" } })]).length, 0, "already ordered again");
  assert.equal(pick([order({ cancelledAt: "2026-09-01T00:00:00Z" })]).length, 0, "cancelled");
  assert.equal(pick([order({ displayFinancialStatus: "PARTIALLY_REFUNDED" })]).length, 0, "refunded");
  assert.equal(pick([order({ returnStatus: "RETURN_REQUESTED" })]).length, 0, "return");
  assert.equal(pick([order({ fulfillments: [{ status: "SUCCESS", deliveredAt: new Date(NOW - 10 * DAY).toISOString() }] })]).length, 0, "too soon");
  assert.equal(pick([order({ fulfillments: [{ status: "SUCCESS", deliveredAt: new Date(NOW - 40 * DAY).toISOString() }] })]).length, 0, "too late to say 'a few weeks'");
  assert.equal(pick([order({ fulfillments: [{ status: "SUCCESS", deliveredAt: null, events: { nodes: [{ status: "IN_TRANSIT", happenedAt: "2026-09-10T00:00:00Z" }] } }] })]).length, 0, "never delivered");
  assert.equal(pick([order()], ["gid://shopify/Customer/7"]).length, 0, "nudged before");
  assert.equal(withinNudgeHours(new Date("2026-10-08T15:00:00Z")), false, "8:30 pm IST");
});

test("cron sends the merchant's offer line once and skips open chats and opted-out numbers", async () => {
  const sends: any[] = [];
  const audits: any[] = [];
  const db: any = {
    shop: { findMany: async () => [{ id: "s1", shopDomain: "shop.myshopify.com", primaryDomain: "megaska.com" }] },
    auditEvent: { findMany: async () => [], create: async (args: any) => { audits.push(args.data); } },
    whatsAppConversation: { findFirst: async (args: any) => (args.where.contactPhone === "919111111111" ? { id: "open" } : null) },
  };
  const orders = [
    order(),
    order({ id: "o2", name: "#522401", customer: { id: "c2", firstName: "Meera", numberOfOrders: 1 }, shippingAddress: { firstName: "Meera", phone: "9111111111" } }),
    order({ id: "o3", name: "#522402", customer: { id: "c3", firstName: "Sara", numberOfOrders: 1 }, shippingAddress: { firstName: "Sara", phone: "9222222222" } }),
  ];
  const summary = await runWhatsAppSecondOrderNudges({ now: new Date(NOW) }, {
    db,
    listAccounts: async () => [{ shopId: "s1", secondOrderDelayDays: 21, secondOrderOffer: "Prepaid orders get 15% off at checkout." } as any],
    senderFor: () => ({ source: "MERCHANT", accessToken: "t", phoneNumberId: "pn", languageCode: "en", templates: {} }),
    graphql: async (_query, variables: any) => { assert.match(variables.query, /fulfillment_status:shipped/); return { orders: { nodes: orders, pageInfo: { hasNextPage: false } } } as any; },
    sendTemplate: async (send) => { sends.push(send); return { success: true, messageId: "m1" }; },
    isOptedOut: async (phone) => phone === "919222222222",
  });
  assert.equal(summary.sent, 1);
  assert.equal(summary.skippedOpenChat, 1);
  assert.equal(summary.skippedOptOut, 1);
  assert.equal(sends[0].templateName, "second_order_nudge");
  assert.deepEqual(sends[0].variables, ["Asha", "Frock Style Swim Dress", "https://megaska.com/?utm_source=whatsapp&utm_medium=second_order", "Prepaid orders get 15% off at checkout."]);
  assert.equal(audits[0].eventType, SECOND_ORDER_SENT_EVENT);
  assert.equal(audits[0].entityId, "gid://shopify/Customer/7");
});

test("no offer line, no nudges", async () => {
  const summary = await runWhatsAppSecondOrderNudges({ now: new Date(NOW) }, { listAccounts: async () => [{ shopId: "s1", secondOrderOffer: "  " } as any] });
  assert.equal(summary.shops, 0);
});
