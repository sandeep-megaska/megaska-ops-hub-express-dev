/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { verifyCodRecoveryToken } from "../checkout-recovery/prepaid-cod-recovery.ts";
import { rebuildBagPage } from "../checkout-recovery/rebuild-bag-page.ts";
import { describeInbound } from "./inbox.ts";
import { cartLinesFromOrder, handleWhatsAppCatalogOrder, productListMessage, resolveCatalogId, retailerIdFor, sendCatalogMessage, sendProductCards, variantIdFromRetailerId } from "./shop-in-chat.ts";

const SECRET = "s".repeat(40);
const NOW = new Date("2026-10-09T06:00:00Z");

test("catalog retailer ids map to Shopify variants (Shopify feed ids, plain ids, gids); others are SKUs", () => {
  assert.equal(variantIdFromRetailerId("shopify_IN_8123456789012_44012345678901"), 44012345678901);
  assert.equal(variantIdFromRetailerId("44012345678901"), 44012345678901);
  assert.equal(variantIdFromRetailerId("gid://shopify/ProductVariant/44012345678901"), 44012345678901);
  assert.equal(variantIdFromRetailerId("MGSW14-BLK-M"), null);
  assert.equal(variantIdFromRetailerId(""), null);
});

test("cart lines add up repeated items and cap quantities", () => {
  assert.deepEqual(cartLinesFromOrder([
    { product_retailer_id: "shopify_IN_1_11", quantity: 1 },
    { product_retailer_id: "shopify_IN_1_11", quantity: "2" },
    { product_retailer_id: "shopify_IN_2_22", quantity: 40 },
    { product_retailer_id: "", quantity: 1 },
    { product_retailer_id: "shopify_IN_3_33", quantity: 0 },
  ]), [{ retailerId: "shopify_IN_1_11", quantity: 3 }, { retailerId: "shopify_IN_2_22", quantity: 10 }]);
});

test("the inbox shows a catalog cart in words", () => {
  assert.equal(describeInbound({ type: "order", order: { product_items: [{ product_retailer_id: "a", quantity: 2, item_price: 1195, currency: "INR" }, { product_retailer_id: "b", quantity: 1, item_price: 599, currency: "INR" }] } } as any).body, "🛒 Cart from catalog: 3 items · ₹2,989");
});

function setup(nodes: any[], overrides: any = {}) {
  const sent: string[] = [];
  const updates: any[] = [];
  const audits: any[] = [];
  const db: any = {
    merchantWhatsAppAccount: { findUnique: async () => ({ enabled: true, shopInChatEnabled: true, ...overrides.account }) },
    whatsAppConversation: { findFirst: async () => ({ id: "c1", shopId: "s1", contactPhone: "919876543210", contactName: "Asha" }), update: async (args: any) => { updates.push(args.data); } },
    shop: { findUnique: async () => ({ id: "s1", shopDomain: "shop.myshopify.com", primaryDomain: "megaska.com" }) },
    auditEvent: { create: async (args: any) => { audits.push(args.data); } },
  };
  const deps: any = {
    db,
    secret: SECRET,
    graphql: async (_query: string, variables: any) => (variables.ids ? { nodes } : { productVariants: { nodes: overrides.skuNodes ?? [] } }),
    sendText: async (input: any) => { sent.push(input.text); },
    alert: async () => undefined,
  };
  return { deps, sent, updates, audits };
}

test("a WhatsApp cart becomes one reply with a signed bag link holding exactly the in-stock items", async () => {
  const { deps, sent, audits } = setup([
    { id: "gid://shopify/ProductVariant/11", title: "Black / M", availableForSale: true, product: { title: "Front Zip Swimsuit", status: "ACTIVE" } },
    { id: "gid://shopify/ProductVariant/22", title: "XL", availableForSale: false, product: { title: "Frock Swim Dress", status: "ACTIVE" } },
  ]);
  const result = await handleWhatsAppCatalogOrder({ shopId: "s1", conversationId: "c1", waMessageId: "wamid.9", items: [{ product_retailer_id: "shopify_IN_1_11", quantity: 2 }, { product_retailer_id: "shopify_IN_2_22", quantity: 1 }], now: NOW }, deps);
  assert.deepEqual(result, { outcome: "link_sent", items: 1 });
  assert.match(sent[0], /Your bag is ready/);
  assert.match(sent[0], /• Front Zip Swimsuit \(Black \/ M\) × 2/);
  assert.match(sent[0], /sold out right now: Frock Swim Dress \(XL\)/);
  const token = decodeURIComponent(sent[0].match(/bag\?t=(\S+)/)![1]);
  assert.match(sent[0], /https:\/\/megaska\.com\/apps\/loopd2c\/checkout\/bag\?t=/);
  assert.deepEqual(verifyCodRecoveryToken(token, { shopId: "s1", now: NOW }, SECRET), { checkoutId: "wa:wamid.9", items: [{ variantId: 11, quantity: 2 }] });
  assert.equal(audits[0].eventType, "WHATSAPP_CART_LINK_SENT");
});

test("SKUs as catalog ids are looked up; unmatched carts go to the team; switched off does nothing", async () => {
  const sku = setup([], { skuNodes: [{ id: "gid://shopify/ProductVariant/33", sku: "MGSW14-BLK-M", title: "M", availableForSale: true, product: { title: "Front Zip Swimsuit" } }] });
  assert.equal((await handleWhatsAppCatalogOrder({ shopId: "s1", conversationId: "c1", waMessageId: "w", items: [{ product_retailer_id: "MGSW14-BLK-M", quantity: 1 }], now: NOW }, sku.deps)).outcome, "link_sent");

  const unmatched = setup([]);
  assert.equal((await handleWhatsAppCatalogOrder({ shopId: "s1", conversationId: "c1", waMessageId: "w", items: [{ product_retailer_id: "shopify_IN_1_99", quantity: 1 }], now: NOW }, unmatched.deps)).outcome, "unmatched");
  assert.equal(unmatched.updates[0].needsHuman, true);
  assert.match(unmatched.sent[0], /team will check your cart/);

  const off = setup([], { account: { shopInChatEnabled: false } });
  assert.equal((await handleWhatsAppCatalogOrder({ shopId: "s1", conversationId: "c1", waMessageId: "w", items: [{ product_retailer_id: "shopify_IN_1_11", quantity: 1 }], now: NOW }, off.deps)).outcome, "disabled");
  assert.equal(off.sent.length, 0);

  const noSecret = setup([]);
  assert.equal((await handleWhatsAppCatalogOrder({ shopId: "s1", conversationId: "c1", waMessageId: "w", items: [{ product_retailer_id: "shopify_IN_1_11", quantity: 1 }], now: NOW }, { ...noSecret.deps, secret: null })).outcome, "not_configured");
});

test("bags from WhatsApp carts are tagged so their orders can be counted", () => {
  assert.match(rebuildBagPage([{ variantId: 11, quantity: 1 }], "bag", { source: "whatsapp_cart" }), /"loopd2c_source":"whatsapp_cart"/);
  assert.doesNotMatch(rebuildBagPage([{ variantId: 11, quantity: 1 }], "bag"), /loopd2c_source/);
});

test("the catalog message opens the shop's catalog", async () => {
  let sentMessage: any = null;
  await sendCatalogMessage({ shopId: "s1", conversationId: "c1" }, { send: async (message) => { sentMessage = message; } });
  assert.equal(sentMessage.interactive.type, "catalog_message");
  assert.equal(sentMessage.interactive.action.name, "catalog_message");
  assert.equal(sentMessage.inboxBody, "🛍️ Catalog sent");
});


const cardProduct = (id: string, title: string, sizes: Array<[string, boolean]>) => ({ id: `gid://shopify/Product/${id}`, title, variants: sizes.map(([size, available], index) => ({ id: `gid://shopify/ProductVariant/${id}${index}`, size, color: "", available })) });

test("product cards: one section per product with its in-stock sizes, as Shopify-synced catalog ids", () => {
  assert.equal(retailerIdFor("gid://shopify/Product/81", "gid://shopify/ProductVariant/440"), "shopify_IN_81_440");
  const message: any = productListMessage({ catalogId: "999", header: "Bikini sets", products: [cardProduct("81", "High Waisted Two Piece Bikini Set Camouflage Print", [["S", true], ["M", false], ["L", true]]), cardProduct("82", "Sold Out Set", [["M", false]])] });
  assert.equal(message.type, "product_list");
  assert.equal(message.action.catalog_id, "999");
  assert.equal(message.header.text, "Bikini sets");
  assert.equal(message.action.sections.length, 1, "products with nothing in stock are left out");
  assert.equal(message.action.sections[0].title.length <= 24, true);
  assert.deepEqual(message.action.sections[0].product_items, [{ product_retailer_id: "shopify_IN_81_810" }, { product_retailer_id: "shopify_IN_81_812" }]);
  assert.equal(productListMessage({ catalogId: "999", header: "x", products: [cardProduct("82", "Sold Out Set", [["M", false]])] }), null);
});

test("the catalog id is looked up once from the WhatsApp Business Account", async () => {
  const fetcher = (async () => ({ ok: true, json: async () => ({ data: [{ id: "777" }] }) })) as any;
  assert.equal(await resolveCatalogId({ wabaId: "1", accessToken: "t" }, fetcher), "777");
  const updates: any[] = [];
  const sent: any[] = [];
  const db: any = { merchantWhatsAppAccount: { findUnique: async () => ({ shopId: "s1", enabled: true, phoneNumberId: "pn", accessTokenEncrypted: "e", businessAccountId: "1", catalogId: null, templateLanguage: "en" }), update: async (args: any) => { updates.push(args.data); } } };
  const result = await sendProductCards({ shopId: "s1", conversationId: "c1", header: "Bikini sets", products: [cardProduct("81", "Bikini", [["S", true]])] }, { db, fetcher, decrypt: () => "token", send: async (message) => { sent.push(message); } });
  assert.equal(result, "cards");
  assert.deepEqual(updates[0], { catalogId: "777" });
  assert.equal(sent[0].interactive.type, "product_list");
});

test("when cards cannot be sent the whole catalog opens instead", async () => {
  const sent: any[] = [];
  const db: any = { merchantWhatsAppAccount: { findUnique: async () => ({ shopId: "s1", enabled: true, phoneNumberId: "pn", accessTokenEncrypted: "e", businessAccountId: null, catalogId: "999", templateLanguage: "en" }), update: async () => undefined } };
  let first = true;
  const result = await sendProductCards({ shopId: "s1", conversationId: "c1", header: "x", products: [cardProduct("81", "Bikini", [["S", true]])] }, { db, send: async (message) => { if (first) { first = false; throw new Error("(#131009) Product not found in catalog"); } sent.push(message); } });
  assert.equal(result, "catalog");
  assert.equal(sent[0].interactive.type, "catalog_message");
});
