import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAjaxCartPricing } from "./normalize.ts";
import { ajaxCartPricingFixtures } from "./ajax-cart-fixtures.ts";

const base = ajaxCartPricingFixtures.noDiscount;

test("normalizes no discount cart", () => {
  const model = normalizeAjaxCartPricing(base, { fetchedAt: "2026-07-10T00:00:00.000Z" });
  assert.equal(model.authoritative, true);
  assert.equal(model.sourceType, "ajax-cart");
  assert.equal(model.currency, "INR");
  assert.equal(model.originalSubtotal.amount, 10000);
  assert.equal(model.finalTotal.amount, 10000);
  assert.equal(model.discountAllocations, null);
});

test("normalizes product app discount without fabricating app attribution", () => {
  const model = normalizeAjaxCartPricing(ajaxCartPricingFixtures.productAppDiscount);
  assert.equal(model.lines[0].discountAllocations?.[0].amount.amount, 3000);
  assert.equal(model.lines[0].discountAllocations?.[0].title, "LoopDesk offer");
  assert.equal(model.lines[0].discountAllocations?.[0].appKey, null);
  assert.equal(model.rawCapabilities.loopDeskAppDiscountAttribution, false);
});

test("normalizes Shopify code discount with unavailable applicability", () => {
  const model = normalizeAjaxCartPricing(ajaxCartPricingFixtures.shopifyCodeDiscount);
  assert.deepEqual(model.discountCodes, [{ code: "SAVE10", applicable: null }]);
});

test("normalizes combined function and Shopify code discounts", () => {
  const model = normalizeAjaxCartPricing(ajaxCartPricingFixtures.combinedDiscounts);
  assert.equal(model.discountAllocations?.length, 2);
  assert.equal(model.totalDiscount.amount, 4000);
});

test("coupon removal returns no code and restored totals", () => {
  const model = normalizeAjaxCartPricing(ajaxCartPricingFixtures.couponRemoved);
  assert.deepEqual(model.discountCodes, []);
  assert.equal(model.totalDiscount.amount, 0);
});

test("normalizes multi-line cart", () => {
  const model = normalizeAjaxCartPricing(ajaxCartPricingFixtures.multiLine);
  assert.equal(model.lines.length, 2);
  assert.equal(model.lines[1].quantity, 2);
});

test("preserves multiple allocations on one line", () => {
  const model = normalizeAjaxCartPricing({ ...base, items: [{ ...base.items[0], discounts: [{ amount: 111, title: "A" }, { amount: 222, title: "B" }] }] });
  assert.deepEqual(model.lines[0].discountAllocations?.map((a) => a.amount.amount), [111, 222]);
});

test("returns explicit unavailable fields when allocation details are missing", () => {
  const model = normalizeAjaxCartPricing({ ...base, items: [{ ...base.items[0], discounts: undefined }], total_price: undefined });
  assert.equal(model.lines[0].discountAllocations, null);
  assert.deepEqual(model.finalTotal, { amount: null, currencyCode: "INR", available: false });
});

test("preserves exact minor units", () => {
  const model = normalizeAjaxCartPricing({ ...base, total_price: 9999, total_discount: 1 });
  assert.equal(model.finalTotal.amount, 9999);
  assert.equal(model.totalDiscount.amount, 1);
});

test("source response cannot override currency inconsistently", () => {
  const model = normalizeAjaxCartPricing({ ...base, currency: "INR", items: [{ ...base.items[0], discounts: [{ amountSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } } }] }] });
  assert.equal(model.discountAllocations?.[0].amount.currencyCode, "INR");
  assert.equal(model.lines[0].discountAllocations?.[0].amount.currencyCode, "INR");
  assert.equal(model.lines[0].finalLineTotal.currencyCode, "INR");
});

test("finalTotal equals Shopify-provided total and is not derived by subtraction", () => {
  const model = normalizeAjaxCartPricing({ ...base, original_total_price: 10000, total_discount: 3333, items_subtotal_price: 6667, total_price: 6668 });
  assert.equal(model.finalTotal.amount, 6668);
});
