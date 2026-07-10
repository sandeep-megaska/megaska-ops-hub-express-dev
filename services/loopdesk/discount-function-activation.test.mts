import test from "node:test";
import assert from "node:assert/strict";
import { deterministicConfigHash, selectLoopDeskAppDiscountType, verifyStoredConfig, type AppDiscountType, type AutomaticDiscount } from "./discount-function-activation.server.ts";
import type { LoopDeskDiscountFunctionConfig } from "./discount-function.ts";

const config: LoopDeskDiscountFunctionConfig = { schemaVersion: 1, enabled: true, rules: [{ id: "a", enabled: true, priority: 1, triggerType: "always", rewardEnforcementType: "fixed_price", rewardVariantGid: "gid://shopify/ProductVariant/1", rewardProductGid: "gid://shopify/Product/1", fixedPriceAmount: 300 }] };
const metafield = { value: JSON.stringify(config) };
const functionType: AppDiscountType = { functionId: "gid://shopify/ShopifyFunction/selected", title: "LoopDesk Discount Function", discountClasses: ["PRODUCT"] };

test("deterministic config hashes ignore object key ordering", () => {
  const left: LoopDeskDiscountFunctionConfig = config;
  const right: LoopDeskDiscountFunctionConfig = { rules: [{ fixedPriceAmount: 300, rewardProductGid: "gid://shopify/Product/1", rewardVariantGid: "gid://shopify/ProductVariant/1", rewardEnforcementType: "fixed_price", triggerType: "always", priority: 1, enabled: true, id: "a" }], enabled: true, schemaVersion: 1 };
  assert.equal(deterministicConfigHash(left), deterministicConfigHash(right));
});

test("selects a single exact-title PRODUCT candidate using functionId", () => {
  const result = selectLoopDeskAppDiscountType([
    { functionId: "other", title: "Other Function", discountClasses: ["PRODUCT"] },
    functionType,
  ]);
  assert.equal(result.reason, null);
  assert.equal(result.selected?.functionId, functionType.functionId);
});

test("candidate without PRODUCT returns wrong_discount_class", () => {
  const result = selectLoopDeskAppDiscountType([{ functionId: "order-only", title: "LoopDesk Discount Function", discountClasses: ["ORDER"] }]);
  assert.equal(result.selected, null);
  assert.equal(result.reason, "wrong_discount_class");
});

test("no candidate returns missing_function", () => {
  const result = selectLoopDeskAppDiscountType([{ functionId: "other", title: "Other Function", description: "No match", discountClasses: ["PRODUCT"] }]);
  assert.equal(result.selected, null);
  assert.equal(result.reason, "missing_function");
});

test("multiple broad LoopDesk candidates return ambiguous_function_identity", () => {
  const result = selectLoopDeskAppDiscountType([
    { functionId: "one", title: "Custom", description: "LoopDesk helper", discountClasses: ["PRODUCT"] },
    { functionId: "two", title: "Legacy", description: "LoopDesk helper", discountClasses: ["PRODUCT"] },
  ]);
  assert.equal(result.selected, null);
  assert.equal(result.reason, "ambiguous_function_identity");
});

test("selection does not depend on functionHandle", () => {
  const result = selectLoopDeskAppDiscountType([{ functionId: "no-handle", title: "LoopDesk Promotions", discountClasses: ["PRODUCT"] }]);
  assert.equal(result.reason, null);
  assert.equal(result.selected?.functionId, "no-handle");
});

test("automatic discount with matching functionId passes Function identity verification", () => {
  const node: AutomaticDiscount = { id: "node", automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount", appDiscountType: { functionId: functionType.functionId }, metafield } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("mismatched automatic-discount functionId returns function_identity_mismatch", () => {
  const node: AutomaticDiscount = { id: "node", automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount", appDiscountType: { functionId: "gid://shopify/ShopifyFunction/other" }, metafield } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("function_identity_mismatch"));
});
