import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  const node: AutomaticDiscount = { id: "node", metafield, automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount", appDiscountType: { functionId: functionType.functionId } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("mismatched automatic-discount functionId returns function_identity_mismatch", () => {
  const node: AutomaticDiscount = { id: "node", metafield, automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount", appDiscountType: { functionId: "gid://shopify/ShopifyFunction/other" } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("function_identity_mismatch"));
});

test("metafield verification reads from the automatic-discount node", () => {
  const node: AutomaticDiscount = {
    id: "node",
    metafield,
    automaticDiscount: {
      __typename: "DiscountAutomaticApp",
      title: "LoopDesk Promotions",
      status: "ACTIVE",
      discountId: "discount",
      appDiscountType: { functionId: functionType.functionId },
    },
  };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.metafieldRawValue, metafield.value);
  assert.deepEqual(result.metafieldParsed, config);
});

test("valid JSON produces a stored config hash", () => {
  const node: AutomaticDiscount = { id: "node", metafield, automaticDiscount: { __typename: "DiscountAutomaticApp", status: "ACTIVE", appDiscountType: { functionId: functionType.functionId } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.storedConfigHash, deterministicConfigHash(config));
});

test("semantically matching JSON passes verification", () => {
  const semanticallyMatchingConfig: LoopDeskDiscountFunctionConfig = {
    rules: [{ fixedPriceAmount: 300, rewardProductGid: "gid://shopify/Product/1", rewardVariantGid: "gid://shopify/ProductVariant/1", rewardEnforcementType: "fixed_price", triggerType: "always", priority: 1, enabled: true, id: "a" }],
    enabled: true,
    schemaVersion: 1,
  };
  const node: AutomaticDiscount = { id: "node", metafield: { value: JSON.stringify(semanticallyMatchingConfig) }, automaticDiscount: { __typename: "DiscountAutomaticApp", status: "ACTIVE", appDiscountType: { functionId: functionType.functionId } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("missing node-level metafield returns missing_or_invalid_metafield", () => {
  const node: AutomaticDiscount = { id: "node", automaticDiscount: { __typename: "DiscountAutomaticApp", status: "ACTIVE", appDiscountType: { functionId: functionType.functionId } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("missing_or_invalid_metafield"));
});

test("different compiled and stored hashes return stale_metafield", () => {
  const staleConfig: LoopDeskDiscountFunctionConfig = { ...config, enabled: false };
  const node: AutomaticDiscount = { id: "node", metafield: { value: JSON.stringify(staleConfig) }, automaticDiscount: { __typename: "DiscountAutomaticApp", status: "ACTIVE", appDiscountType: { functionId: functionType.functionId } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("stale_metafield"));
});


test("automatic discount GraphQL fragments do not request metafield from DiscountAutomaticApp", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  for (const occurrence of source.matchAll(/\.\.\.\s+on\s+DiscountAutomaticApp\s*\{/g)) {
    const followingTemplateSource = source.slice(occurrence.index, source.indexOf("`", occurrence.index));
    assert.equal(followingTemplateSource.includes("metafield("), false);
  }
});
