import test from "node:test";
import assert from "node:assert/strict";
import { buildReplacementDraftOrder, isNoInvoiceOrderTags, normalizeSize, pickSizeVariant, replacementChargePaise } from "./replacement-order.ts";

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
