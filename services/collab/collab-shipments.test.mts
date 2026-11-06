import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCollabDraftOrderInput,
  collabCsv,
  expectsContent,
  fillMissingCosts,
  isCollabOrderTags,
  monthRange,
  normalizeCollabInput,
  normalizeIndianPhone,
  priceCollabItems,
  summarizeCollabs,
  trackingUpdate,
} from "./collab-shipments.ts";
import { buildOrderShipmentPayload, normalizeShippableOrder } from "../logistics/order-shipments.ts";

const V1 = "gid://shopify/ProductVariant/1";
const V2 = "gid://shopify/ProductVariant/2";
const valid = {
  purpose: "influencer",
  recipientName: "Asha Menon",
  recipientPhone: "098470 12345",
  recipientEmail: "",
  recipientHandle: "@asha",
  platform: "Instagram",
  campaign: "Diwali",
  address: { address1: "12 MG Road, Flat 4", city: "Kochi", state: "Kerala", pin: "682016" },
  items: [{ variantId: V1, quantity: 1 }, { variantId: V1, quantity: 2 }, { variantId: V2, quantity: 1 }, { variantId: "bad", quantity: 1 }],
  weightGrams: "700",
  notifyRecipient: true,
};

test("form input is validated and merged", () => {
  const parsed = normalizeCollabInput(valid);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.purpose, "INFLUENCER");
  assert.equal(parsed.data.recipientPhone, "+919847012345");
  assert.deepEqual(parsed.data.items, [{ variantId: V1, quantity: 3 }, { variantId: V2, quantity: 1 }]);
  assert.equal(parsed.data.weightGrams, 700);
  assert.equal(parsed.data.notifyRecipient, false, "no email, no notification");
  assert.equal(normalizeCollabInput({ ...valid, address: { ...valid.address, pin: "68201" } }).ok, false);
  assert.equal(normalizeCollabInput({ ...valid, address: { ...valid.address, state: "Kerela" } }).ok, false);
  assert.equal(normalizeCollabInput({ ...valid, items: [] }).ok, false);
  assert.equal(normalizeIndianPhone("+91 98470 12345"), "+919847012345");
  assert.equal(normalizeIndianPhone("12345"), null);
});

test("items are priced from Shopify, with stock and cost checks", () => {
  const nodes = [
    { id: V1, displayName: "Swim dress - M", sku: "SD-M", price: "1499.00", inventoryQuantity: 5, inventoryItem: { tracked: true, unitCost: { amount: "420.50" } } },
    { id: V2, displayName: "Cap", sku: "CAP", price: "299", inventoryQuantity: 0, inventoryPolicy: "CONTINUE", inventoryItem: { tracked: true, unitCost: null } },
  ];
  const priced = priceCollabItems([{ variantId: V1, quantity: 3 }, { variantId: V2, quantity: 1 }], nodes);
  assert.equal(priced.ok, true);
  if (!priced.ok) return;
  assert.equal(priced.retailValuePaise, 3 * 149900 + 29900);
  assert.equal(priced.productCostPaise, 3 * 42050);
  assert.equal(priced.warnings.length, 2);
  const short = priceCollabItems([{ variantId: V1, quantity: 6 }], nodes);
  assert.equal(short.ok, false);
  assert.equal(priceCollabItems([{ variantId: "gid://shopify/ProductVariant/9", quantity: 1 }], nodes).ok, false);
});

test("the Shopify order is free, untaxed and tagged", () => {
  const parsed = normalizeCollabInput(valid);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const draft = buildCollabDraftOrderInput("c1", parsed.data);
  assert.deepEqual(draft.appliedDiscount.value, 100);
  assert.equal(draft.appliedDiscount.valueType, "PERCENTAGE");
  assert.equal(draft.taxExempt, true);
  assert.ok(draft.tags.includes("LoopD2C Collab"));
  assert.equal(draft.shippingAddress.firstName, "Asha");
  assert.equal(draft.shippingAddress.province, "Kerala");
  assert.ok(draft.customAttributes.some((attr) => attr.key === "loopd2c_collab_id" && attr.value === "c1"));
  assert.ok(isCollabOrderTags("VIP, LoopD2C Collab, Collab: Influencer"));
  assert.ok(isCollabOrderTags(["loopd2c collab"]));
  assert.equal(isCollabOrderTags("LoopD2C Express Checkout"), false);
});

test("a ₹0 order books Prepaid at the declared retail value", () => {
  const order = normalizeShippableOrder({
    id: "gid://shopify/Order/1", name: "#1100", createdAt: "2026-11-06T00:00:00Z", displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED",
    currentTotalPriceSet: { shopMoney: { amount: "0.00", currencyCode: "INR" } }, totalOutstandingSet: { shopMoney: { amount: "0.00" } }, customAttributes: [],
    shippingAddress: { name: "Asha Menon", phone: "+919847012345", address1: "12 MG Road", city: "Kochi", province: "Kerala", zip: "682016", country: "India" },
    lineItems: { nodes: [{ title: "Swim dress", variantTitle: "M", sku: "SD-M", unfulfilledQuantity: 1 }] },
  } as never);
  assert.equal(order.blockers.length, 0);
  const runtime = { pickupLocationName: "Megaska", warehouse: {} } as never;
  const payload = buildOrderShipmentPayload(order, runtime, { weightGrams: 500, shippingMode: "Surface" }, 149900);
  assert.equal(payload.shipments[0].payment_mode, "Prepaid");
  assert.equal(payload.shipments[0].cod_amount, 0);
  assert.equal(payload.shipments[0].total_amount, 1499);
  assert.equal(buildOrderShipmentPayload(order, runtime, { weightGrams: 500, shippingMode: "Surface" }).shipments[0].total_amount, 0);
});

test("tracking, totals, CSV and month range", () => {
  const delivered = trackingUpdate({ normalizedStatus: "DELIVERED", rawStatus: "Delivered", statusUpdatedAt: new Date("2026-11-08T10:00:00Z") }, { trackingUrl: "t", deliveredAt: null });
  assert.equal(delivered.deliveredAt?.toISOString(), "2026-11-08T10:00:00.000Z");
  assert.equal(delivered.trackingUrl, "t");
  const row = {
    id: "c1", createdAt: new Date("2026-11-06T05:00:00Z"), purpose: "INFLUENCER", recipientName: "Asha, M", recipientPhone: "+919847012345", recipientHandle: "=cmd", platform: "Instagram",
    campaign: null, address: { city: "Kochi", state: "Kerala" }, items: [{ variantId: V1, title: "Dress", sku: "SD", quantity: 2, unitPricePaise: 100000, unitCostPaise: 30000 }, { variantId: V2, title: "Cap", sku: "CAP", quantity: 1, unitPricePaise: 29900, unitCostPaise: null }],
    retailValuePaise: 229900, productCostPaise: 60000, shippingCostPaise: 8500, status: "BOOKED", shopifyOrderName: "#1100", awb: "123", trackingStatus: "DELIVERED" as const,
    deliveredAt: new Date("2026-11-08T10:00:00Z"), deliverableStatus: "POSTED", contentUrl: "https://instagram.com/p/x", postedAt: null, notes: null,
  };
  const csv = collabCsv([row]).trim().split("\n");
  assert.equal(csv.length, 3);
  assert.ok(csv[1].includes('"Asha, M"'));
  assert.ok(csv[1].includes("'=cmd"), "formula-like cells are escaped");
  assert.ok(csv[1].includes(",2000.00,600.00,85.00,"));
  assert.ok(csv[2].includes(",299.00,,,"), "shipping only on the first line, blank cost stays blank");
  const summary = summarizeCollabs([row, { ...row, status: "FAILED" }, { ...row, deliverableStatus: "NOT_NEEDED", trackingStatus: null }]);
  assert.deepEqual(summary, { parcels: 2, retailValuePaise: 459800, productCostPaise: 120000, shippingCostPaise: 17000, delivered: 1, posted: 1, expectingPost: 1 });
  const range = monthRange("2026-11");
  assert.equal(range.from.toISOString(), "2026-10-31T18:30:00.000Z");
  assert.equal(range.to.toISOString(), "2026-11-30T18:30:00.000Z");
});

test("vendor samples carry the company and expect no content", () => {
  const parsed = normalizeCollabInput({ ...valid, purpose: "vendor_sample", recipientHandle: "", address: { ...valid.address, company: "Lakshmi Textiles" } });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.data.address.company, "Lakshmi Textiles");
  const draft = buildCollabDraftOrderInput("c2", parsed.data);
  assert.equal(draft.shippingAddress.company, "Lakshmi Textiles");
  assert.ok(draft.tags.includes("Free parcel: Sample to vendor / manufacturer"));
  assert.ok(draft.note.includes("Company: Lakshmi Textiles"));
  assert.equal(draft.appliedDiscount.title, "Sample to vendor / manufacturer - paid by store");
  assert.equal(expectsContent("VENDOR_SAMPLE"), false);
  assert.equal(expectsContent("INTERNAL"), false);
  assert.equal(expectsContent("INFLUENCER"), true);
  const csv = collabCsv([{ id: "c2", createdAt: new Date("2026-11-06T05:00:00Z"), purpose: "VENDOR_SAMPLE", recipientName: "Ravi", recipientPhone: "+919847012345", recipientHandle: null, platform: null,
    campaign: "PO-77", address: { company: "Lakshmi Textiles", city: "Tiruppur", state: "Tamil Nadu" }, items: [{ variantId: V1, title: "Dress", sku: "SD", quantity: 1, unitPricePaise: 100000, unitCostPaise: 30000 }],
    retailValuePaise: 100000, productCostPaise: 30000, shippingCostPaise: null, status: "BOOKED", shopifyOrderName: "#1101", awb: null, trackingStatus: null, deliveredAt: null,
    deliverableStatus: "NOT_NEEDED", contentUrl: null, postedAt: null, notes: null }]).trim().split("\n");
  assert.ok(csv[0].includes("Campaign / reference,Company,Recipient"));
  assert.ok(csv[1].includes("Sample to vendor / manufacturer,PO-77,Lakshmi Textiles,Ravi"));
});

test("missing costs are filled in later; recorded costs never change", () => {
  const items = [
    { variantId: V1, title: "Dress", sku: "SD", quantity: 2, unitPricePaise: 100000, unitCostPaise: null },
    { variantId: V2, title: "Cap", sku: "CAP", quantity: 1, unitPricePaise: 29900, unitCostPaise: 5000 },
    { variantId: "gid://shopify/ProductVariant/3", title: "Bag", sku: "BAG", quantity: 1, unitPricePaise: 50000, unitCostPaise: null },
  ];
  const nodes = [
    { id: V1, inventoryItem: { unitCost: { amount: "410.00" } } },
    { id: V2, inventoryItem: { unitCost: { amount: "99.00" } } },
    { id: "gid://shopify/ProductVariant/3", inventoryItem: { unitCost: null } },
  ];
  const result = fillMissingCosts(items, nodes);
  assert.equal(result.filled, 1);
  assert.equal(result.stillMissing, 1);
  assert.equal(result.items[0].unitCostPaise, 41000);
  assert.equal(result.items[1].unitCostPaise, 5000, "cost at the time stays");
  assert.equal(result.productCostPaise, 2 * 41000 + 5000);
});
