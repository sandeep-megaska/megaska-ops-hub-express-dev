/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { cardProducts, runWhatsAppAssistant } from "./run.ts";
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

function restockSetup(aiReply: any, backInStockEnabled = true) {
  const base = setup({ aiReply });
  const saved: any[] = [];
  base.deps.db.merchantWhatsAppAccount.findUnique = async () => ({ shopId: "shop-1", enabled: true, aiMode: "AUTO", aiKnowledge: null, backInStockEnabled });
  base.deps.loadContext = async () => ({
    storeName: "Megaska", storeUrl: "https://megaska.com", policies: [], merchantNotes: null, orders: [],
    products: [productFromNode({ id: "gid://shopify/Product/1", title: "Swim Dress", handle: "swim-dress", variants: { nodes: [
      { id: "gid://shopify/ProductVariant/11", title: "M", availableForSale: true, selectedOptions: [{ name: "Size", value: "M" }] },
      { id: "gid://shopify/ProductVariant/12", title: "XL", availableForSale: false, selectedOptions: [{ name: "Size", value: "XL" }] },
    ] } } as any, "https://megaska.com")],
  });
  let system = "";
  const complete = base.deps.complete;
  base.deps.complete = async (input: any) => { system = input.system; return complete(input); };
  base.deps.saveRestock = async (input: any) => { saved.push(input); };
  return { ...base, saved, system: () => system };
}

test("back in stock: the customer's 'notify me' is saved against the sold-out size", async () => {
  const { deps, sent, saved, system } = restockSetup({ reply: "Done! We'll WhatsApp you here as soon as XL is back.", intent: "product", needs_human: false, confidence: 0.9, restock_request: { product: "Swim Dress", size: "XL", color: null } });
  const result = await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, deps);
  assert.equal(result.status, "sent");
  assert.deepEqual(sent, ["Done! We'll WhatsApp you here as soon as XL is back."]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].phone, "919539180257");
  assert.equal(saved[0].target.variantId, "gid://shopify/ProductVariant/12");
  assert.equal(saved[0].target.variantTitle, "Size XL");
  assert.match(system(), /restock_request/);
});

test("back in stock: an alert the shop cannot set up goes to the team; switched off, nothing is saved", async () => {
  const unmatched = restockSetup({ reply: "Sure, we'll let you know!", intent: "product", needs_human: false, confidence: 0.9, restock_request: { product: "Bikini Set", size: "S", color: null } });
  await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, unmatched.deps);
  assert.equal(unmatched.saved.length, 0);
  assert.equal(unmatched.updates[0].handoffKind, "SOFT");
  assert.match(unmatched.updates[0].handoffReason, /Back-in-stock request not matched to a product: Bikini Set/);

  const off = restockSetup({ reply: "OK", intent: "product", needs_human: false, confidence: 0.9, restock_request: { product: "Swim Dress", size: "XL", color: null } }, false);
  await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, off.deps);
  assert.equal(off.saved.length, 0);
  assert.doesNotMatch(off.system(), /restock_request/);
});

test("the assistant sees which sizes are sold out", () => {
  const product = productFromNode({ id: "p", title: "Swim Dress", handle: "d", variants: { nodes: [
    { id: "v1", title: "M", availableForSale: true, selectedOptions: [{ name: "Size", value: "M" }] },
    { id: "v2", title: "XL", availableForSale: false, selectedOptions: [{ name: "Size", value: "XL" }] },
  ] } } as any, "https://megaska.com");
  assert.equal(product?.sizes, "M");
  assert.equal(product?.soldOut, "XL");
});

test("shop in chat: a browsing customer gets the reply and then the catalog", async () => {
  const base = setup({ aiReply: { reply: "Here are our styles! Pick your size, add to cart and tap Place order.", intent: "product", needs_human: false, confidence: 0.9, show_catalog: true } });
  const catalogs: any[] = [];
  let system = "";
  base.deps.db.merchantWhatsAppAccount.findUnique = async () => ({ shopId: "shop-1", enabled: true, aiMode: "AUTO", aiKnowledge: null, shopInChatEnabled: true });
  const complete = base.deps.complete;
  base.deps.complete = async (input: any) => { system = input.system; return complete(input); };
  base.deps.sendCatalog = async (input: any) => { catalogs.push(input); };
  await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, base.deps);
  assert.equal(base.sent.length, 1);
  assert.deepEqual(catalogs, [{ shopId: "shop-1", conversationId: "c1" }]);
  assert.match(system, /show_catalog/);

  const off = setup({ aiReply: { reply: "Here!", intent: "product", needs_human: false, confidence: 0.9, show_catalog: true } });
  const offCatalogs: any[] = [];
  off.deps.sendCatalog = async (input: any) => { offCatalogs.push(input); };
  await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, off.deps);
  assert.equal(offCatalogs.length, 0, "not sent when shop in chat is off");
});


test("product cards: named products are matched (in stock, no duplicates) and sent after a short reply", async () => {
  const product = (title: string, inStock = true) => ({ id: `gid://shopify/Product/${title.length}`, title, url: null, price: "₹929", sizes: "S, M", inStock, description: "" });
  const products = [product("Camouflage Bikini Set"), product("Sporty Bikini Set"), product("Old Bikini", false)];
  assert.deepEqual(cardProducts(["camouflage bikini set", "Camouflage Bikini Set", "Old Bikini", "Sporty"], products as any).map((entry) => entry.title), ["Camouflage Bikini Set", "Sporty Bikini Set"]);

  const base = setup({ aiReply: { reply: "Here are our bikini sets 👇 Pick your size, add to cart and tap Place order.", intent: "product", needs_human: false, confidence: 0.9, show_products: ["Camouflage Bikini Set"], cards_title: "Bikini sets" } });
  base.deps.db.merchantWhatsAppAccount.findUnique = async () => ({ shopId: "shop-1", enabled: true, aiMode: "AUTO", aiKnowledge: null, shopInChatEnabled: true });
  base.deps.loadContext = async () => ({ storeName: "Megaska", storeUrl: null, policies: [], merchantNotes: null, orders: [], products });
  const cards: any[] = [];
  let system = "";
  const complete = base.deps.complete;
  base.deps.complete = async (input: any) => { system = input.system; return complete(input); };
  base.deps.sendProductCards = async (input: any) => { cards.push(input); };
  base.deps.sendCatalog = async () => { throw new Error("catalog should not be sent"); };
  await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, base.deps);
  assert.equal(base.sent.length, 1);
  assert.equal(cards[0].header, "Bikini sets");
  assert.deepEqual(cards[0].products.map((entry: any) => entry.title), ["Camouflage Bikini Set"]);
  assert.match(system, /show_products/);
  assert.match(system, /NO product links/);
});

test("a second quick message that arrived while the model was thinking gets the reply, not the first", async () => {
  const later = new Date(NOW.getTime() + 6000);
  const base = setup({ messages: [{ id: "m1", direction: "INBOUND", waMessageId: "wamid.1", type: "text", body: "Bangalore", createdAt: NOW }] });
  let calls = 0;
  const findMany = base.deps.db.whatsAppMessage.findMany;
  base.deps.db.whatsAppMessage.findMany = async (args: any) => {
    calls += 1;
    if (args?.where?.direction === "INBOUND") return [{ id: "m2", direction: "INBOUND", waMessageId: "wamid.2", type: "text", body: "560004 pin code", createdAt: later }];
    return findMany(args);
  };
  const result = await runWhatsAppAssistant({ shopId: "shop-1", conversationId: "c1", waMessageId: "wamid.1" }, base.deps);
  assert.deepEqual(result, { status: "skipped", outcome: "superseded_by_newer_message" });
  assert.equal(base.sent.length, 0);
  assert.ok(calls >= 2);
});
