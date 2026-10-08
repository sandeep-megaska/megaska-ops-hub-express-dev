/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { runWhatsAppAssistant } from "./run.ts";
import { orderFromNode, productFromNode } from "./store-context.ts";

const NOW = new Date("2026-10-07T08:00:00Z");

function setup(overrides: { mode?: string; messages?: any[]; conversation?: any; aiReply?: any; aiConfigured?: boolean } = {}) {
  const updates: any[] = [];
  const sent: string[] = [];
  const alerts: any[] = [];
  const messages = overrides.messages ?? [{ id: "m1", direction: "INBOUND", waMessageId: "wamid.1", type: "text", body: "Is the swim dress available in XL?", createdAt: NOW }];
  const db: any = {
    merchantWhatsAppAccount: { findUnique: async () => ({ shopId: "shop-1", enabled: true, aiMode: overrides.mode ?? "AUTO", aiKnowledge: "Delivery in 3-7 days." }) },
    shop: { findUnique: async () => ({ id: "shop-1", shopDomain: "bigonbuy-fashions.myshopify.com" }) },
    whatsAppConversation: {
      findFirst: async () => ({ id: "c1", shopId: "shop-1", businessPhoneNumberId: "1327042750500585", contactPhone: "919539180257", contactName: "Sandeep", needsHuman: false, aiPausedUntil: null, ...overrides.conversation }),
      update: async (args: any) => { updates.push(args.data); },
    },
    whatsAppMessage: { findMany: async () => [...messages].reverse(), count: async () => 0 },
  };
  const deps: any = {
    db,
    now: () => NOW,
    sleep: async () => undefined,
    aiConfigured: () => overrides.aiConfigured ?? true,
    loadContext: async () => ({ storeName: "Megaska", storeUrl: "https://megaska.com", policies: [], merchantNotes: null, products: [], orders: [] }),
    complete: async () => overrides.aiReply ?? { reply: "Yes! XL is in stock at ₹1,195: https://megaska.com/products/swim-dress", intent: "product", needs_human: false, confidence: 0.9 },
    sendText: async (input: any) => { sent.push(input.text); },
    typing: async () => undefined,
    alert: async (input: any) => { alerts.push(input); },
  };
  return { deps, updates, sent, alerts };
}

test("AUTO: a product question gets the assistant's answer, no team alert", async () => {
  const { deps, sent, alerts } = setup();
  const result = await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, deps);
  assert.equal(result.status, "sent");
  assert.deepEqual(sent, ["Yes! XL is in stock at ₹1,195: https://megaska.com/products/swim-dress"]);
  assert.equal(alerts.length, 0);
});

test("AUTO: a complaint gets one holding message, the chat is flagged for the team and they are emailed", async () => {
  const { deps, sent, alerts, updates } = setup({ aiReply: { reply: "So sorry! Our team will sort this out shortly.", intent: "complaint", needs_human: true, handoff_reason: "Damaged item", confidence: 0.9 } });
  const result = await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, deps);
  assert.equal(result.status, "handoff");
  assert.deepEqual(sent, ["So sorry! Our team will sort this out shortly."]);
  assert.deepEqual(updates[0], { needsHuman: true, handoffKind: "HARD", handoffReason: "Damaged item" });
  assert.match(alerts[0].subject, /Sandeep needs a reply/);
});

test("DRAFT: nothing is sent; the suggestion is stored on the chat", async () => {
  const { deps, sent, updates } = setup({ mode: "DRAFT" });
  const result = await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, deps);
  assert.equal(result.status, "drafted");
  assert.equal(sent.length, 0);
  assert.equal(updates[0].aiDraft, "Yes! XL is in stock at ₹1,195: https://megaska.com/products/swim-dress");
});

test("only the latest of several quick messages is answered", async () => {
  const { deps, sent } = setup({ messages: [
    { id: "m1", direction: "INBOUND", waMessageId: "wamid.1", type: "text", body: "Hi", createdAt: NOW },
    { id: "m2", direction: "INBOUND", waMessageId: "wamid.2", type: "text", body: "XL available?", createdAt: NOW },
  ] });
  assert.equal((await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, deps)).outcome, "newer_message_pending");
  assert.equal(sent.length, 0);
});

test("AI failure in AUTO hands over with a holding message instead of going silent", async () => {
  const { deps, sent, updates } = setup();
  deps.complete = async () => { throw new Error("timeout"); };
  const result = await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, deps);
  assert.equal(result.outcome, "ai_unavailable");
  assert.equal(sent.length, 1);
  assert.equal(updates[0].needsHuman, true);
});

test("a chat already with the team is left alone", async () => {
  const { deps, sent } = setup({ conversation: { needsHuman: true } });
  assert.equal((await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, deps)).status, "skipped");
  assert.equal(sent.length, 0);
});

test("store data is turned into plain facts: sizes in stock, prices, order status and tracking", () => {
  const product = productFromNode({
    title: "Black Swim Dress", handle: "black-swim-dress", onlineStoreUrl: null, description: "<p>Full coverage.</p>",
    priceRangeV2: { minVariantPrice: { amount: "1195.0", currencyCode: "INR" }, maxVariantPrice: { amount: "1195.0", currencyCode: "INR" } },
    variants: { nodes: [
      { title: "M", availableForSale: true, selectedOptions: [{ name: "Size", value: "M" }] },
      { title: "XL", availableForSale: false, selectedOptions: [{ name: "Size", value: "XL" }] },
    ] },
  }, "https://megaska.com");
  assert.deepEqual(product, { title: "Black Swim Dress", url: "https://megaska.com/products/black-swim-dress", price: "₹1195", sizes: "M", inStock: true, description: "Full coverage." });

  const order = orderFromNode({
    name: "#522435", createdAt: "2026-10-07T06:44:23Z", cancelledAt: null, displayFinancialStatus: "PENDING", displayFulfillmentStatus: "FULFILLED",
    paymentGatewayNames: ["Cash on Delivery (COD)"], totalPriceSet: { shopMoney: { amount: "1195.0", currencyCode: "INR" } },
    lineItems: { nodes: [{ title: "Swim Dress", quantity: 1, variantTitle: "L" }] },
    fulfillments: [{ displayStatus: "IN_TRANSIT", estimatedDeliveryAt: null, deliveredAt: null, trackingInfo: [{ number: "123", url: "https://track.example/123", company: "Delhivery" }] }],
  });
  assert.equal(order?.status, "in transit");
  assert.equal(order?.payment, "cash on delivery");
  assert.equal(order?.tracking, "https://track.example/123");
  assert.equal(order?.items, "1× Swim Dress (L)");
});

test("last night's chat: after a SOFT 'let me check' handoff, the refund policy question is still answered, with no second email", async () => {
  const { deps, sent, alerts, updates } = setup({
    conversation: { needsHuman: true, handoffKind: "SOFT" },
    messages: [{ id: "m9", direction: "INBOUND", waMessageId: "wamid.9", type: "text", body: "What is refund policy", createdAt: NOW }],
    aiReply: { reply: "Refunds are processed within 10 business days to your original payment method once we receive the item.", intent: "policy", needs_human: false, confidence: 0.9 },
  });
  const result = await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.9" }, deps);
  assert.equal(result.status, "sent");
  assert.equal(sent.length, 1);
  assert.equal(alerts.length, 0);
  assert.equal(updates.length, 0, "the earlier SOFT flag stays for the team");
});

test("a SOFT chat that turns into a complaint is raised to HARD and the team is emailed", async () => {
  const { deps, alerts, updates } = setup({
    conversation: { needsHuman: true, handoffKind: "SOFT" },
    aiReply: { reply: "So sorry! Our team will sort this out.", intent: "complaint", needs_human: true, handoff_kind: "hard", confidence: 0.9 },
  });
  await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, deps);
  assert.equal(updates[0].handoffKind, "HARD");
  assert.equal(alerts.length, 1);
});

test("a second SOFT 'let me check' in an already flagged chat sends the reply but no second email", async () => {
  const { deps, sent, alerts, updates } = setup({
    conversation: { needsHuman: true, handoffKind: "SOFT" },
    aiReply: { reply: "Let me check that with the team.", intent: "product", needs_human: true, handoff_kind: "soft", confidence: 0.8 },
  });
  await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, deps);
  assert.deepEqual(sent, ["Let me check that with the team."]);
  assert.equal(alerts.length + updates.length, 0);
});
