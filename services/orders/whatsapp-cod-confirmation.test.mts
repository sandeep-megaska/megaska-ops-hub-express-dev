/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import {
  COD_CONFIRMATION_RESPONSE_EVENT, COD_CONFIRMATION_SENT_EVENT, COD_REPLIES, codTemplateComponents, handleCodConfirmationReply, orderPhones,
  parseCodPayload, runWhatsAppCodConfirmation, selectCodOrders,
} from "./whatsapp-cod-confirmation.ts";

const MIN = 60_000;
const NOW = Date.parse("2026-10-07T10:00:00Z");
const order = (overrides: any = {}) => ({
  id: "gid://shopify/Order/7001", name: "522440", createdAt: new Date(NOW - 10 * MIN).toISOString(), cancelledAt: null,
  displayFulfillmentStatus: "UNFULFILLED", paymentGatewayNames: ["Cash on Delivery (COD)"], tags: [], phone: null,
  totalPriceSet: { shopMoney: { amount: "1195.0", currencyCode: "INR" } },
  customer: { firstName: "Asha", defaultPhoneNumber: { phoneNumber: "+919876543210" } },
  shippingAddress: { firstName: "Asha Rao", phone: "098765 43210" }, customAttributes: [], ...overrides,
});

test("only fresh, unshipped, unanswered COD orders with a phone are asked", () => {
  assert.deepEqual(selectCodOrders([order()], NOW).map((o) => [o.orderName, o.phone, o.firstName, o.total]), [["522440", "919876543210", "Asha", "₹1,195"]]);
  assert.equal(selectCodOrders([order({ paymentGatewayNames: ["Razorpay Secure"] })], NOW).length, 0, "prepaid");
  assert.equal(selectCodOrders([order({ createdAt: new Date(NOW - 1 * MIN).toISOString() })], NOW).length, 0, "too fresh");
  assert.equal(selectCodOrders([order({ createdAt: new Date(NOW - 7 * 60 * MIN).toISOString() })], NOW).length, 0, "too old");
  assert.equal(selectCodOrders([order({ cancelledAt: new Date(NOW).toISOString() })], NOW).length, 0, "cancelled");
  assert.equal(selectCodOrders([order({ displayFulfillmentStatus: "FULFILLED" })], NOW).length, 0, "shipped");
  assert.equal(selectCodOrders([order({ tags: ["COD-Confirmed"] })], NOW).length, 0, "already answered");
  assert.equal(selectCodOrders([order({ customer: null, shippingAddress: null })], NOW).length, 0, "no phone");
});

test("the OTP-verified phone wins, and every phone on the order is accepted for replies", () => {
  const node = order({ customAttributes: [{ key: "megaska_verified_phone", value: "+91 91111 22222" }] });
  assert.deepEqual(orderPhones(node), ["919111122222", "919876543210"]);
});

test("template carries name, order, total and button payloads; payloads parse back", () => {
  const [selected] = selectCodOrders([order()], NOW);
  const components = codTemplateComponents(selected) as any[];
  assert.deepEqual(components[0].parameters.map((p: any) => p.text), ["Asha", "522440", "₹1,195"]);
  assert.equal(components[1].parameters[0].payload, "codc:confirm:7001");
  assert.equal(components[2].parameters[0].payload, "codc:cancel:7001");
  assert.deepEqual(parseCodPayload("codc:cancel:7001"), { action: "cancel", orderId: "gid://shopify/Order/7001" });
  assert.equal(parseCodPayload("codc:refund:7001"), null);
  assert.equal(parseCodPayload("Confirm order"), null);
});

function fakeDb(events: any[] = []) {
  const updates: any[] = [];
  return {
    events, updates,
    shop: { findMany: async () => [{ id: "shop-1", shopDomain: "shop.myshopify.com" }], findUnique: async () => ({ id: "shop-1", shopDomain: "shop.myshopify.com" }) },
    auditEvent: {
      findMany: async (args: any) => events.filter((e) => !args.where.entityId || e.entityId === args.where.entityId).filter((e) => !args.where.eventType?.in || args.where.eventType.in.includes(e.eventType)).filter((e) => typeof args.where.eventType !== "string" || e.eventType === args.where.eventType),
      create: async ({ data }: any) => { events.push({ ...data, createdAt: new Date(NOW) }); },
    },
    merchantWhatsAppAccount: { findFirst: async () => ({ shopId: "shop-1" }) },
    whatsAppConversation: { findUnique: async () => ({ id: "conv-1", contactName: "Asha" }), update: async (args: any) => { updates.push(args.data); } },
  };
}
const sender: any = { phoneNumberId: "111", languageCode: "en", templates: { codConfirm: "cod_order_confirmation" } };

test("run asks each new COD order once and records it", async () => {
  const db = fakeDb();
  const sends: any[] = [];
  const graphql: any = async () => ({ orders: { nodes: [order(), order({ id: "gid://shopify/Order/7002", paymentGatewayNames: ["Razorpay"] })], pageInfo: { hasNextPage: false } } });
  const deps: any = { db, graphql, listAccounts: async () => [{ shopId: "shop-1" }], senderFor: () => sender, isOptedOut: async () => false, sendTemplate: async (input: any) => { sends.push(input); return { success: true, messageId: "wamid.1" }; } };
  const summary = await runWhatsAppCodConfirmation({ now: new Date(NOW) }, deps);
  assert.equal(summary.sent, 1);
  assert.equal(sends[0].toPhone, "919876543210");
  assert.equal(sends[0].templateName, "cod_order_confirmation");
  assert.equal(db.events[0].eventType, COD_CONFIRMATION_SENT_EVENT);
  const again = await runWhatsAppCodConfirmation({ now: new Date(NOW + 15 * MIN) }, deps);
  assert.equal(again.sent, 0, "never asked twice");
});

test("no reply in 12 hours: the order is tagged cod-no-response once", async () => {
  const db = fakeDb([{ eventType: COD_CONFIRMATION_SENT_EVENT, entityId: "gid://shopify/Order/7001", createdAt: new Date(NOW - 13 * 60 * MIN), payload: { shopId: "shop-1", orderName: "522440" } }]);
  const tags: string[] = [];
  const graphql: any = async (query: string, variables: any) => (query.includes("tagsAdd") ? (tags.push(variables.tags[0]), { tagsAdd: { userErrors: [] } }) : { orders: { nodes: [], pageInfo: {} } });
  const deps: any = { db, graphql, listAccounts: async () => [{ shopId: "shop-1" }], senderFor: () => sender, isOptedOut: async () => false, sendTemplate: async () => ({ success: true }) };
  assert.equal((await runWhatsAppCodConfirmation({ now: new Date(NOW) }, deps)).noResponseTagged, 1);
  assert.deepEqual(tags, ["cod-no-response"]);
  assert.equal((await runWhatsAppCodConfirmation({ now: new Date(NOW + 15 * MIN) }, deps)).noResponseTagged, 0);
});

function replyDeps(orderOverrides: any = {}) {
  const db = fakeDb();
  const tags: string[] = [];
  const sent: string[] = [];
  const alerts: any[] = [];
  const graphql: any = async (query: string, variables: any) => (query.includes("tagsAdd") ? (tags.push(variables.tags[0]), { tagsAdd: { userErrors: [] } }) : { order: order(orderOverrides) });
  return { db, tags, sent, alerts, deps: { db, graphql, sendText: async (input: any) => { sent.push(input.text); }, alert: async (input: any) => { alerts.push(input); } } as any };
}

test("Confirm tags the order and thanks the customer, once", async () => {
  const { deps, tags, sent, db } = replyDeps();
  const input = { businessPhoneNumberId: "111", fromPhone: "919876543210", payload: "codc:confirm:7001" };
  assert.equal((await handleCodConfirmationReply(input, deps)).outcome, "confirmed");
  assert.deepEqual(tags, ["cod-confirmed"]);
  assert.deepEqual(sent, [COD_REPLIES.confirmed("522440")]);
  assert.equal(db.events[0].eventType, COD_CONFIRMATION_RESPONSE_EVENT);
  assert.equal((await handleCodConfirmationReply(input, deps)).outcome, "already_confirmed");
  assert.equal(sent.length, 1);
});

test("Cancel tags the order, flags the chat for the team and emails them; nothing is cancelled", async () => {
  const { deps, tags, sent, alerts, db } = replyDeps();
  const result = await handleCodConfirmationReply({ businessPhoneNumberId: "111", fromPhone: "919876543210", payload: "codc:cancel:7001" }, deps);
  assert.equal(result.outcome, "cancel_requested");
  assert.deepEqual(tags, ["cod-cancel-requested"]);
  assert.deepEqual(sent, [COD_REPLIES.cancelRequested("522440")]);
  assert.equal(db.updates[0].needsHuman, true);
  assert.match(alerts[0].subject, /Cancel request for COD order 522440/);
});

test("a reply from a phone that is not on the order does nothing", async () => {
  const { deps, tags, sent } = replyDeps();
  assert.equal((await handleCodConfirmationReply({ businessPhoneNumberId: "111", fromPhone: "919000000000", payload: "codc:cancel:7001" }, deps)).outcome, "phone_mismatch");
  assert.equal(tags.length + sent.length, 0);
});

test("Cancel on a shipped order says so; a cancelled order is not re-tagged", async () => {
  const shipped = replyDeps({ displayFulfillmentStatus: "FULFILLED" });
  await handleCodConfirmationReply({ businessPhoneNumberId: "111", fromPhone: "919876543210", payload: "codc:cancel:7001" }, shipped.deps);
  assert.deepEqual(shipped.sent, [COD_REPLIES.alreadyShippedCancel("522440")]);
  const cancelled = replyDeps({ cancelledAt: new Date(NOW).toISOString() });
  assert.equal((await handleCodConfirmationReply({ businessPhoneNumberId: "111", fromPhone: "919876543210", payload: "codc:confirm:7001" }, cancelled.deps)).outcome, "already_cancelled");
  assert.equal(cancelled.tags.length, 0);
});
