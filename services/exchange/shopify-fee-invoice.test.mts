import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
const { buildDraftOrderInput, isShopifyDraftOrderId, FEE_REF_ATTRIBUTE, FEE_ORDER_TAG } = await import("./shopify-fee-invoice.ts");

const base = { shopId: "shop-a", requestId: "req-1", amount: 12000, title: "Reverse pickup", referenceId: "ld2c_ref", customerId: "gid://shopify/Customer/7", customerEmail: "a@example.com" };

test("the reverse pickup charge is a shipping line, with a ₹0 informational line Shopify requires", () => {
  const input = buildDraftOrderInput({ ...base, asShipping: true, lineTitle: "Reverse pickup for order #1002" }, "shipping") as Record<string, unknown>;
  assert.deepEqual(input.shippingLine, { title: "Reverse pickup", priceWithCurrency: { amount: "120.00", currencyCode: "INR" } });
  const [line] = input.lineItems as Array<Record<string, unknown>>;
  assert.equal(line.title, "Reverse pickup for order #1002");
  assert.deepEqual(line.originalUnitPriceWithCurrency, { amount: "0.00", currencyCode: "INR" });
  assert.equal(line.requiresShipping, false, "nothing to ship");
  assert.equal(line.variantId, undefined, "not a product");
  assert.deepEqual(input.tags, [FEE_ORDER_TAG]);
  assert.deepEqual((input.customAttributes as Array<{ key: string; value: string }>).find((a) => a.key === FEE_REF_ATTRIBUTE)?.value, "ld2c_ref");
  assert.deepEqual(input.purchasingEntity, { customerId: "gid://shopify/Customer/7" });
  assert.equal((input.customAttributes as Array<{ key: string; value: string }>).find((a) => a.key === "loopd2c_payment_intent")?.value, "prepaid", "COD hidden at checkout");
  assert.equal(input.acceptAutomaticDiscounts, false, "the prepaid offer can't discount the charge");
  assert.equal(input.allowDiscountCodesInCheckout, false);
});

test("fallback and price differences use one custom, non-shippable line", () => {
  for (const input of [buildDraftOrderInput({ ...base, asShipping: true }, "item"), buildDraftOrderInput({ ...base, title: "Price difference", asShipping: false }, "item")] as Array<Record<string, unknown>>) {
    assert.equal(input.shippingLine, undefined);
    const [line] = input.lineItems as Array<Record<string, unknown>>;
    assert.equal(line.quantity, 1);
    assert.equal(line.requiresShipping, false);
    assert.equal(line.variantId, undefined, "not linked to a product");
    assert.deepEqual(line.originalUnitPriceWithCurrency, { amount: "120.00", currencyCode: "INR" });
  }
});

test("helpers", () => {
  assert.equal(isShopifyDraftOrderId("gid://shopify/DraftOrder/1"), true);
  assert.equal(isShopifyDraftOrderId("plink_123"), false);
});
