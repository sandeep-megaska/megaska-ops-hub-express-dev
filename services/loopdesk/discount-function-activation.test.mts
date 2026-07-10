import test from "node:test";
import assert from "node:assert/strict";
import { deterministicConfigHash, selectLoopDeskAppDiscountType } from "./discount-function-activation.server.ts";
import type { LoopDeskDiscountFunctionConfig } from "./discount-function.ts";

test("deterministic config hashes ignore object key ordering", () => {
  const left: LoopDeskDiscountFunctionConfig = { schemaVersion: 1, enabled: true, rules: [{ id: "a", enabled: true, priority: 1, triggerType: "always", rewardEnforcementType: "fixed_price", rewardVariantGid: "gid://shopify/ProductVariant/1", rewardProductGid: "gid://shopify/Product/1", fixedPriceAmount: 300 }] };
  const right: LoopDeskDiscountFunctionConfig = { rules: [{ fixedPriceAmount: 300, rewardProductGid: "gid://shopify/Product/1", rewardVariantGid: "gid://shopify/ProductVariant/1", rewardEnforcementType: "fixed_price", triggerType: "always", priority: 1, enabled: true, id: "a" }], enabled: true, schemaVersion: 1 };
  assert.equal(deterministicConfigHash(left), deterministicConfigHash(right));
});

test("app discount type selection requires exact PRODUCT-capable Function handle", () => {
  assert.equal(selectLoopDeskAppDiscountType([]).selected, null);
  assert.equal(selectLoopDeskAppDiscountType([{ functionId: "1", functionHandle: "loopdesk-discount-function", title: "LoopDesk Discount Function", discountClasses: ["ORDER"] }]).reason, "wrong_discount_class");
  assert.equal(selectLoopDeskAppDiscountType([
    { functionId: "1", functionHandle: "loopdesk-discount-function", title: "LoopDesk Discount Function", discountClasses: ["PRODUCT"] },
    { functionId: "2", functionHandle: "loopdesk-discount-function", title: "LoopDesk Discount Function", discountClasses: ["PRODUCT"] },
  ]).selected?.functionId, "1");
  assert.equal(selectLoopDeskAppDiscountType([
    { functionId: "broad-title", title: "LoopDesk Discount Function", discountClasses: ["PRODUCT"] },
  ]).selected, null);
  assert.equal(selectLoopDeskAppDiscountType([{ functionId: "1", functionHandle: "loopdesk-discount-function", title: "LoopDesk Discount Function", discountClasses: ["PRODUCT"] }]).selected?.functionId, "1");
});
