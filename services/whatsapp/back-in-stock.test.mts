/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { isBackInStock, resolveRestockTarget, restockItemLabel, restockLink, runWhatsAppBackInStock, withinRestockHours } from "./back-in-stock.ts";

const product = {
  id: "gid://shopify/Product/1",
  title: "Frock Style Swim Dress",
  url: "https://megaska.com/products/frock",
  variants: [
    { id: "gid://shopify/ProductVariant/11", size: "M", color: "Black", available: true },
    { id: "gid://shopify/ProductVariant/12", size: "XL", color: "Black", available: false },
    { id: "gid://shopify/ProductVariant/13", size: "XL", color: "Navy", available: false },
  ],
};

test("a sold-out size and colour resolves to that one variant", () => {
  const match = resolveRestockTarget({ product: "frock style swim dress", size: "xl", color: "Navy" }, [product]);
  assert.equal(match.kind, "target");
  if (match.kind !== "target") return;
  assert.equal(match.target.variantId, "gid://shopify/ProductVariant/13");
  assert.equal(match.target.key, "gid://shopify/ProductVariant/13");
  assert.equal(restockItemLabel(match.target), "Frock Style Swim Dress (XL / Navy)");
});

test("a size sold out in every colour waits for any colour of that size", () => {
  const match = resolveRestockTarget({ product: "Frock Style Swim Dress", size: "XL", color: null }, [product]);
  assert.equal(match.kind, "target");
  if (match.kind !== "target") return;
  assert.equal(match.target.variantId, null);
  assert.equal(match.target.optionSize, "XL");
  assert.equal(match.target.variantTitle, "Size XL");
  assert.equal(match.target.key, "gid://shopify/Product/1|xl|");
});

test("nothing is saved for something in stock or not shown to the assistant", () => {
  assert.equal(resolveRestockTarget({ product: "Frock Style Swim Dress", size: "M", color: null }, [product]).kind, "in_stock");
  assert.equal(resolveRestockTarget({ product: "Bikini", size: null, color: null }, [product]).kind, "unmatched");
  assert.equal(resolveRestockTarget({ product: "Frock Style Swim Dress", size: "S", color: null }, [product]).kind, "unmatched", "size the product does not come in");
});

test("stock check follows the variant, or the size/colour asked for", () => {
  const stock = (available: string[]) => ({ id: "p", status: "ACTIVE", variants: { nodes: [
    { id: "v-xl-black", availableForSale: available.includes("v-xl-black"), selectedOptions: [{ name: "Size", value: "XL" }, { name: "Color", value: "Black" }] },
    { id: "v-m-black", availableForSale: available.includes("v-m-black"), selectedOptions: [{ name: "Size", value: "M" }, { name: "Color", value: "Black" }] },
  ] } });
  assert.equal(isBackInStock({ variantId: "v-xl-black", optionSize: null, optionColor: null }, stock(["v-m-black"])), false);
  assert.equal(isBackInStock({ variantId: "v-xl-black", optionSize: null, optionColor: null }, stock(["v-xl-black"])), true);
  assert.equal(isBackInStock({ variantId: null, optionSize: "XL", optionColor: null }, stock(["v-m-black"])), false);
  assert.equal(isBackInStock({ variantId: null, optionSize: "XL", optionColor: null }, stock(["v-xl-black"])), true);
  assert.equal(isBackInStock({ variantId: null, optionSize: "XL", optionColor: null }, { ...stock(["v-xl-black"]), status: "DRAFT" }), false, "unpublished products are not announced");
});

test("links open the variant and are tagged for analytics; quiet hours respected", () => {
  assert.equal(restockLink("https://megaska.com/products/frock", "gid://shopify/ProductVariant/12"), "https://megaska.com/products/frock?variant=12&utm_source=whatsapp&utm_medium=back_in_stock");
  assert.equal(withinRestockHours(new Date("2026-10-08T03:00:00Z")), false, "8:30 am IST");
  assert.equal(withinRestockHours(new Date("2026-10-08T04:00:00Z")), true, "9:30 am IST");
});

test("cron tells each waiting customer once, skips opted-out ones and expires old requests", async () => {
  const requests: any[] = [
    { id: "r1", shopId: "s1", phone: "919876543210", customerName: "Asha Rao", productId: "p1", variantId: "v1", optionSize: null, optionColor: null, productTitle: "Swim Dress", variantTitle: "Size XL", productUrl: "https://megaska.com/products/dress", createdAt: new Date("2026-10-01T00:00:00Z"), status: "WAITING" },
    { id: "r2", shopId: "s1", phone: "919876543210", customerName: "Asha Rao", productId: "p1", variantId: null, optionSize: "L", optionColor: null, productTitle: "Swim Dress", variantTitle: "Size L", productUrl: null, createdAt: new Date("2026-10-02T00:00:00Z"), status: "WAITING" },
    { id: "r3", shopId: "s1", phone: "919000000000", customerName: null, productId: "p1", variantId: "v1", optionSize: null, optionColor: null, productTitle: "Swim Dress", variantTitle: "Size XL", productUrl: null, createdAt: new Date("2026-10-03T00:00:00Z"), status: "WAITING" },
  ];
  const updates: any[] = [];
  const sends: any[] = [];
  const db: any = {
    shop: { findMany: async () => [{ id: "s1", shopDomain: "shop.myshopify.com" }] },
    backInStockRequest: {
      updateMany: async (args: any) => { assert.equal(args.data.status, "EXPIRED"); return { count: 2 }; },
      findMany: async () => requests,
      update: async (args: any) => { updates.push(args); },
      upsert: async () => undefined,
    },
  };
  const summary = await runWhatsAppBackInStock({ now: new Date("2026-10-08T06:00:00Z") }, {
    db,
    listAccounts: async () => [{ shopId: "s1" } as any],
    senderFor: () => ({ source: "MERCHANT", accessToken: "t", phoneNumberId: "pn", languageCode: "en", templates: {} }),
    graphql: async () => ({ nodes: [{ id: "p1", status: "ACTIVE", onlineStoreUrl: "https://megaska.com/products/dress", variants: { nodes: [
      { id: "v1", availableForSale: true, selectedOptions: [{ name: "Size", value: "XL" }] },
      { id: "v2", availableForSale: true, selectedOptions: [{ name: "Size", value: "L" }] },
    ] } }] }) as any,
    sendTemplate: async (send) => { sends.push(send); return { success: true, messageId: `m${sends.length}` }; },
    isOptedOut: async (phone) => phone === "919000000000",
  });
  assert.equal(summary.expired, 2);
  assert.equal(summary.sent, 1, "one message per customer per run");
  assert.equal(summary.skippedOptOut, 1);
  assert.equal(sends[0].templateName, "back_in_stock");
  assert.deepEqual(sends[0].variables, ["Asha", "Swim Dress (Size XL)", "https://megaska.com/products/dress?variant=1&utm_source=whatsapp&utm_medium=back_in_stock"]);
  assert.deepEqual(updates.map((update) => [update.where.id, update.data.status]), [["r1", "NOTIFIED"], ["r3", "CANCELLED"]]);
});
