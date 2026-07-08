import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run.js";

const rewardVariantGid = "gid://shopify/ProductVariant/200";
const triggerVariantGid = "gid://shopify/ProductVariant/100";

function metafieldConfig(config) {
  return { discountNode: { metafield: config ? { value: JSON.stringify(config) } : null }, cart: { lines: [] } };
}

function rule(overrides = {}) {
  return {
    id: "rule-fixed-price",
    enabled: true,
    priority: 1,
    triggerType: "cart_contains_variant",
    triggerValue: triggerVariantGid,
    rewardEnforcementType: "fixed_price",
    rewardVariantGid,
    fixedPriceAmount: 299,
    quantity: 1,
    ...overrides,
  };
}

function input({ config = { enabled: true, rules: [rule()] }, rewardQuantity = 1, rewardSubtotal = 399, rewardVariant = rewardVariantGid } = {}) {
  return {
    discountNode: { metafield: { value: JSON.stringify(config) } },
    cart: {
      lines: [
        {
          id: "gid://shopify/CartLine/trigger",
          quantity: 1,
          cost: { subtotalAmount: { amount: "999.00", currencyCode: "INR" } },
          merchandise: { id: triggerVariantGid, product: { id: "gid://shopify/Product/10", productType: "Shoes", tags: ["trigger"], inCollections: [] } },
        },
        {
          id: "gid://shopify/CartLine/reward",
          quantity: rewardQuantity,
          cost: { subtotalAmount: { amount: String(rewardSubtotal), currencyCode: "INR" } },
          merchandise: { id: rewardVariant, product: { id: "gid://shopify/Product/20", productType: "Socks", tags: ["reward"], inCollections: [] } },
        },
      ],
    },
  };
}

const noDiscounts = { operations: [] };

describe("cartLinesDiscountsGenerateRun fixed_price enforcement", () => {
  it("returns no discount when config is missing", () => {
    assert.deepEqual(cartLinesDiscountsGenerateRun(metafieldConfig(null)), noDiscounts);
  });

  it("returns no discount when config is disabled", () => {
    assert.deepEqual(cartLinesDiscountsGenerateRun(input({ config: { enabled: false, rules: [rule()] } })), noDiscounts);
  });

  it("returns no discount when no cart line matches the reward variant", () => {
    assert.deepEqual(cartLinesDiscountsGenerateRun(input({ rewardVariant: "gid://shopify/ProductVariant/999" })), noDiscounts);
  });

  it("returns a discount operation when the fixed price is lower than the current Shopify cart line unit price", () => {
    assert.deepEqual(cartLinesDiscountsGenerateRun(input()), {
      operations: [
        {
          productDiscountsAdd: {
            candidates: [
              {
                targets: [{ cartLine: { id: "gid://shopify/CartLine/reward", quantity: 1 } }],
                value: { fixedAmount: { amount: "100.00", appliesToEachItem: true } },
                message: "LoopDesk fixed price reward",
              },
            ],
            selectionStrategy: "ALL",
          },
        },
      ],
    });
  });

  it("returns no discount when fixed price is greater than or equal to current price", () => {
    assert.deepEqual(cartLinesDiscountsGenerateRun(input({ config: { enabled: true, rules: [rule({ fixedPriceAmount: 399 })] } })), noDiscounts);
    assert.deepEqual(cartLinesDiscountsGenerateRun(input({ config: { enabled: true, rules: [rule({ fixedPriceAmount: 499 })] } })), noDiscounts);
  });

  it("respects the configured quantity cap", () => {
    const result = cartLinesDiscountsGenerateRun(input({ config: { enabled: true, rules: [rule({ quantity: 2 })] }, rewardQuantity: 5, rewardSubtotal: 1995 }));
    assert.equal(result.operations[0].productDiscountsAdd.candidates[0].targets[0].cartLine.quantity, 2);
  });

  it("ignores unsupported reward types", () => {
    assert.deepEqual(cartLinesDiscountsGenerateRun(input({ config: { enabled: true, rules: [rule({ rewardEnforcementType: "percentage" })] } })), noDiscounts);
  });
});
