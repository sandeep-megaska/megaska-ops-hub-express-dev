import test from "node:test";
import assert from "node:assert/strict";
import { buildReplacementDraftOrder, isNoInvoiceOrderTags, normalizeSize, pickSizeVariant, replacementChargePaise, replacementPackingDescription, swapSizeInVariantTitle } from "./replacement-order.ts";

const variants = [
  { id: "v-navy-l", selectedOptions: [{ name: "Color", value: "Navy Royal Blue" }, { name: "Size", value: "L" }] },
  { id: "v-navy-xl", selectedOptions: [{ name: "Color", value: "Navy Royal Blue" }, { name: "Size", value: "XL" }] },
  { id: "v-black-l", selectedOptions: [{ name: "Color", value: "Black Magenta" }, { name: "Size", value: "L" }] },
];
const original = [{ name: "Color", value: "Navy Royal Blue" }, { name: "Size", value: "XL" }];

test("requested size resolves to the same colour, any spelling", () => {
  assert.equal(pickSizeVariant(original, variants, "Large")?.id, "v-navy-l");
  assert.equal(pickSizeVariant(original, variants, "l")?.id, "v-navy-l");
  assert.equal(pickSizeVariant(original, variants, "XXL"), null);
  assert.equal(normalizeSize("X-Large"), "XL");
  assert.equal(normalizeSize("2XL"), "XXL");
});

test("charge only for a paid, dearer style", () => {
  assert.equal(replacementChargePaise({}), 0);
  assert.equal(replacementChargePaise({ styleDifferencePaise: 31000, styleSettlement: "COLLECT" }), 0, "not paid yet");
  assert.equal(replacementChargePaise({ styleDifferencePaise: 31000, styleSettlement: "COLLECT", styleSettledAt: new Date() }), 31000);
  assert.equal(replacementChargePaise({ styleDifferencePaise: -5000, styleSettlement: "STORE_CREDIT", styleSettledAt: new Date() }), 0);
});

const address = { name: "Asha Menon", phone: "+919847012345", address1: "12 MG Road", address2: "", city: "Kochi", state: "Kerala", pin: "682016" };

test("a ₹0 replacement: 100% off, no tax, no GST invoice", () => {
  const draft = buildReplacementDraftOrder({ requestId: "r1", orderNumber: "#522429", lines: [{ variantId: "v", quantity: 1, unitPricePaise: 129000 }], chargePaise: 0, address });
  assert.deepEqual(draft.appliedDiscount, { title: "Exchange for #522429", description: "Replacement for an exchanged item", value: 100, valueType: "PERCENTAGE" });
  assert.equal(draft.taxExempt, true);
  assert.ok(isNoInvoiceOrderTags(draft.tags));
  assert.equal(draft.shippingAddress.lastName, "Menon");
});

test("a dearer style: the order totals exactly the difference paid, and is invoiced", () => {
  const draft = buildReplacementDraftOrder({ requestId: "r2", orderNumber: "522430", lines: [{ variantId: "v", quantity: 1, unitPricePaise: 179000 }], chargePaise: 31000, address });
  assert.equal(draft.appliedDiscount.valueType, "FIXED_AMOUNT");
  assert.equal(draft.appliedDiscount.value, 1480);
  assert.equal(draft.taxExempt, false);
  assert.equal(isNoInvoiceOrderTags(draft.tags), false);
  assert.match(draft.note, /paid ₹310\.00 difference/);
  assert.ok(isNoInvoiceOrderTags("VIP, LoopD2C Collab"));
});

// Order 522488 -> replacement 522574: the label read "… / Navy Royal / XL / Lycra / Size L /
// MBPS07-NavyRoyal-XL" and the warehouse sent XL again.
const sizeExchange = { productTitle: "Block Color Lycra Full Length Padded One Piece Swimming Costume", variantTitle: "Navy Royal / XL / Lycra", sku: "MBPS07-NavyRoyal-XL", currentSize: "XL", requestedSize: "L", quantity: 1 };

test("the label lists the replacement order's line, SKU first", () => {
  const text = replacementPackingDescription({
    packed: [{ title: sizeExchange.productTitle, variantTitle: "Navy Royal / L / Lycra", sku: "MBPS07-NavyRoyal-L", quantity: 1 }],
    items: [sizeExchange],
  });
  assert.equal(text, "SKU MBPS07-NavyRoyal-L · Block Color Lycra Full Length Padded One Piece Swimming Costume · Navy Royal / L / Lycra · x1");
  assert.doesNotMatch(text, /XL/);
});

test("without the order's lines, the label still never shows the original size or SKU", () => {
  const text = replacementPackingDescription({ packed: [], items: [sizeExchange] });
  assert.match(text, /Navy Royal \/ L \/ Lycra/);
  assert.doesNotMatch(text, /XL/);
  assert.equal(swapSizeInVariantTitle("Navy Royal / XL / Lycra", "XL", "L"), "Navy Royal / L / Lycra");
  assert.equal(swapSizeInVariantTitle("Navy Royal / Lycra", "XL", "L"), null);
  assert.match(replacementPackingDescription({ items: [{ ...sizeExchange, variantTitle: "Navy Royal", currentSize: null }] }), /Size L/);
});

test("a different style ships the chosen product and its SKU", () => {
  const text = replacementPackingDescription({ items: [{ ...sizeExchange, replacementTitle: "Wine / L / Lycra", replacementSku: "MBPS07-Wine-L" }] });
  assert.equal(text, "SKU MBPS07-Wine-L · Wine / L / Lycra · x1");
});
