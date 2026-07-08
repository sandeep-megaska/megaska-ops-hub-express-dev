import test from "node:test";
import assert from "node:assert/strict";

import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run.js";

const rewardVariantGid = "gid://shopify/ProductVariant/reward";
const triggerVariantGid = "gid://shopify/ProductVariant/trigger";

function inputFor(ruleOverrides = {}, linesOverrides = []) {
  const rule = {
    id: "rule-1",
    enabled: true,
    priority: 1,
    triggerType: "cart_contains_variant",
    triggerValue: triggerVariantGid,
    rewardEnforcementType: "percentage",
    rewardVariantGid,
    percentageValue: 20,
    quantity: 1,
    ...ruleOverrides,
  };

  const lines = linesOverrides.length ? linesOverrides : [
    cartLine("trigger-line", triggerVariantGid, 1, 100),
    cartLine("reward-line", rewardVariantGid, 2, 200),
  ];

  return {
    discountNode: { metafield: { value: JSON.stringify({ schemaVersion: 1, enabled: true, rules: [rule] }) } },
    cart: { lines },
  };
}

function cartLine(id, variantGid, quantity, subtotalAmount, product = {}) {
  return {
    id,
    quantity,
    cost: { subtotalAmount: { amount: String(subtotalAmount), currencyCode: "INR" } },
    merchandise: {
      id: variantGid,
      product: {
        id: product.id || "gid://shopify/Product/1",
        productType: product.productType || "",
        tags: product.tags || [],
        inCollections: product.inCollections || [],
      },
    },
  };
}

function operations(input) {
  return cartLinesDiscountsGenerateRun(input).operations;
}

test("fixed_price still applies only to the capped reward line", () => {
  const result = operations(inputFor({ rewardEnforcementType: "fixed_price", fixedPriceAmount: 25, percentageValue: undefined, quantity: 1 }));

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].productDiscountsAdd.candidates[0].targets, [{ cartLine: { id: "reward-line", quantity: 1 } }]);
  assert.deepEqual(result[0].productDiscountsAdd.candidates[0].value, { fixedAmount: { amount: "75.00", appliesToEachItem: true } });
});

test("percentage valid applies discount operation to reward variant only", () => {
  const result = operations(inputFor({ percentageValue: 20 }));

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].productDiscountsAdd.candidates[0].targets, [{ cartLine: { id: "reward-line", quantity: 1 } }]);
  assert.deepEqual(result[0].productDiscountsAdd.candidates[0].value, { percentage: { value: "20" } });
});

for (const percentageValue of [0, -1, 101]) {
  test(`percentage ${percentageValue} ignored`, () => {
    assert.deepEqual(operations(inputFor({ percentageValue })), []);
  });
}

test("no matching reward variant ignored", () => {
  assert.deepEqual(operations(inputFor({ rewardVariantGid: "gid://shopify/ProductVariant/missing" })), []);
});

test("quantity cap respected", () => {
  const result = operations(inputFor({ percentageValue: 15, quantity: 2 }, [
    cartLine("trigger-line", triggerVariantGid, 1, 100),
    cartLine("reward-line", rewardVariantGid, 4, 400),
  ]));

  assert.equal(result[0].productDiscountsAdd.candidates[0].targets[0].cartLine.quantity, 2);
});

test("unsupported reward types ignored", () => {
  for (const rewardEnforcementType of ["fixed_amount", "free_gift", "bundles"]) {
    assert.deepEqual(operations(inputFor({ rewardEnforcementType })), []);
  }
});

test("trigger line is not discounted unless it is also the reward target", () => {
  const result = operations(inputFor({ percentageValue: 10, quantity: 1 }));

  assert.equal(result.length, 1);
  assert.equal(result[0].productDiscountsAdd.candidates[0].targets[0].cartLine.id, "reward-line");
});
