import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../megaska-otp/assets/loopdesk-promotion-pricing.js", import.meta.url), "utf8");
function api() { const window = {}; vm.runInNewContext(source, { window, globalThis: window }); return window.LoopDeskPromotionPricing; }
function cart(overrides = {}) { return { token: "cart-1", currency: "INR", item_count: 1, original_total_price: 120000, items_subtotal_price: 120000, total_discount: 12000, total_price: 108000, items: [], ...overrides }; }

test("Shopify total is authoritative for a 10% order discount", () => {
  const model = api().build(cart());
  assert.equal(model.merchandiseSubtotal, 120000);
  assert.equal(model.qualifyingSubtotal, 120000);
  assert.equal(model.totalSavings, 12000);
  assert.equal(model.finalPayableSubtotal, 108000);
  assert.equal(model.pricingAuthority, "SHOPIFY");
  assert.equal(model.breakdownComplete, false);
});

test("15% Shopify discount on 2400 pays 2040", () => {
  const model = api().build(cart({ original_total_price: 240000, total_discount: 36000, total_price: 204000 }));
  assert.equal(model.finalPayableSubtotal, 204000);
  assert.equal(model.totalSavings, 36000);
});

test("product and coupon allocations are classified without double counting", () => {
  const model = api().build(cart({ original_total_price: 100000, total_discount: 40000, total_price: 60000, discount_codes: [{ code: "SAVE10" }], items: [{ properties: { _loopdesk_promotion_rule_id: "reward" }, discounts: [{ amount: 30000, title: "LoopDesk reward" }, { amount: 10000, title: "SAVE10", code: "SAVE10" }] }] }));
  assert.equal(model.productPromotionSavings, 30000);
  assert.equal(model.couponSavings, 10000);
  assert.equal(model.totalSavings, 40000);
  assert.equal(model.appliedDiscounts.length, 2);
  assert.equal(model.breakdownComplete, true);
});

test("unknown allocations remain in Shopify total and suppress an unreliable split", () => {
  const model = api().build(cart({ total_discount: 12000, total_price: 108000, items: [{ discounts: [{ amount: 12000, title: "Partner discount" }] }] }));
  assert.equal(model.appliedDiscounts[0].type, "UNKNOWN");
  assert.equal(model.totalSavings, 12000);
  assert.equal(model.finalPayableSubtotal, 108000);
  assert.ok(model.warnings.includes("pricing_unclassified_discount"));
  assert.equal(model.breakdownComplete, false);
});

test("an order-wide automatic discount is classified as an order (tier) discount", () => {
  const model = api().build(cart({ original_total_price: 62995, items_subtotal_price: 62995, total_discount: 3149, total_price: 59846,
    items: [{ discounts: [{ amount: 3149, title: "LoopD2C tier", discount_application: { type: "automatic", target_selection: "all", allocation_method: "across", value_type: "percentage", value: "5.0" } }] }] }));
  assert.equal(model.appliedDiscounts[0].type, "ORDER_PROMOTION");
  assert.equal(model.orderPromotionSavings, 3149);
  assert.equal(model.productPromotionSavings, 0);
  assert.equal(model.totalSavings, 3149);
  assert.equal(model.breakdownComplete, true);
  assert.ok(!model.warnings.includes("pricing_unclassified_discount"));
});

test("the order-tier share allocated onto a product-offer line is attributed to the order, not the product", () => {
  const model = api().build(cart({ original_total_price: 122995, items_subtotal_price: 122995, total_discount: 33149, total_price: 89846,
    items: [
      { properties: { _loopdesk_promotion_rule_id: "reward" }, discounts: [
        { amount: 30000, title: "LoopD2C offer", discount_application: { type: "automatic", target_selection: "explicit", allocation_method: "each" } },
        { amount: 1500, title: "LoopD2C tier", discount_application: { type: "automatic", target_selection: "all", allocation_method: "across" } },
      ] },
      { discounts: [{ amount: 1649, title: "LoopD2C tier", discount_application: { type: "automatic", target_selection: "all", allocation_method: "across" } }] },
    ] }));
  assert.equal(model.productPromotionSavings, 30000);
  assert.equal(model.orderPromotionSavings, 3149); // 1500 + 1649, not folded into product
  assert.equal(model.totalSavings, 33149);
  assert.equal(model.breakdownComplete, true);
  assert.ok(!model.warnings.includes("pricing_unclassified_discount"));
});

test("combination policy reports Shopify settings and blocks multiple order discounts", () => {
  const { TYPES, combinationStatus } = api();
  assert.equal(combinationStatus({ productDiscounts: true }, TYPES.PRODUCT, TYPES.ORDER), "CAN_COMBINE");
  assert.equal(combinationStatus({ productDiscounts: false }, TYPES.PRODUCT, TYPES.ORDER), "CANNOT_COMBINE");
  assert.equal(combinationStatus({ orderDiscounts: false }, TYPES.ORDER, TYPES.COUPON), "CANNOT_COMBINE");
  assert.equal(combinationStatus({}, TYPES.ORDER, TYPES.ORDER), "CANNOT_COMBINE");
  assert.equal(combinationStatus(null, TYPES.PRODUCT, TYPES.COUPON), "NOT_VERIFIED");
});

test("fingerprint changes with quantities, totals, and coupon state", () => {
  const pricing = api();
  const base = cart();
  assert.notEqual(pricing.fingerprint(base), pricing.fingerprint({ ...base, item_count: 2 }));
  assert.notEqual(pricing.fingerprint(base), pricing.fingerprint({ ...base, total_price: 107999 }));
  assert.notEqual(pricing.fingerprint(base), pricing.fingerprint({ ...base, discount_codes: [{ code: "SAVE" }] }));
});
