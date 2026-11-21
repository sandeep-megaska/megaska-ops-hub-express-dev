import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
const { buildDraftOrderInput, needsLineItemFallback, isShopifyDraftOrderId, FEE_REF_ATTRIBUTE, FEE_ORDER_TAG } = await import("./shopify-fee-invoice.ts");

const base = { shopId: "shop-a", requestId: "req-1", amount: 12000, title: "Reverse pickup", referenceId: "ld2c_ref", customerId: "gid://shopify/Customer/7", customerEmail: "a@example.com" };

test("the reverse pickup charge is a shipping line, not a product", () => {
  const input = buildDraftOrderInput({ ...base, asShipping: true }, false) as Record<string, unknown>;
  assert.deepEqual(input.shippingLine, { title: "Reverse pickup", priceWithCurrency: { amount: "120.00", currencyCode: "INR" } });
  assert.equal(input.lineItems, undefined);
  assert.deepEqual(input.tags, [FEE_ORDER_TAG]);
  assert.deepEqual((input.customAttributes as Array<{ key: string; value: string }>).find((a) => a.key === FEE_REF_ATTRIBUTE)?.value, "ld2c_ref");
  assert.deepEqual(input.purchasingEntity, { customerId: "gid://shopify/Customer/7" });
});

test("fallback and price differences use one custom, non-shippable line", () => {
  for (const input of [buildDraftOrderInput({ ...base, asShipping: true }, true), buildDraftOrderInput({ ...base, title: "Price difference", asShipping: false }, false)] as Array<Record<string, unknown>>) {
    assert.equal(input.shippingLine, undefined);
    const [line] = input.lineItems as Array<Record<string, unknown>>;
    assert.equal(line.quantity, 1);
    assert.equal(line.requiresShipping, false);
    assert.equal(line.variantId, undefined, "not linked to a product");
    assert.deepEqual(line.originalUnitPriceWithCurrency, { amount: "120.00", currencyCode: "INR" });
  }
});

test("helpers", () => {
  assert.equal(needsLineItemFallback("Line items must have at least one item"), true);
  assert.equal(needsLineItemFallback("Email is invalid"), false);
  assert.equal(isShopifyDraftOrderId("gid://shopify/DraftOrder/1"), true);
  assert.equal(isShopifyDraftOrderId("plink_123"), false);
});
