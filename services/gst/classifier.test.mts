import test from "node:test";
import assert from "node:assert/strict";

import { classifySupply, determinePlaceOfSupply } from "./classifier.ts";

test("determinePlaceOfSupply prioritizes valid state codes before province-name mapping", () => {
  const place = determinePlaceOfSupply({
    shippingStateCode: "Rajasthan",
    billingStateCode: "07",
    buyerStateCode: "Maharashtra",
    placeOfSupplyStateCode: "Karnataka",
  });

  assert.equal(place, "07");
});

test("determinePlaceOfSupply resolves Shopify province/state names", () => {
  const place = determinePlaceOfSupply({
    shippingStateCode: null,
    billingStateCode: null,
    shopifyShippingProvince: "Rajasthan",
    shopifyBillingProvince: "Delhi",
  });

  assert.equal(place, "08");
});

test("classifySupply uses customer default state before manual fallback", () => {
  const result = classifySupply({
    sellerStateCode: "08",
    shippingStateCode: null,
    billingStateCode: null,
    buyerStateCode: "Delhi",
    placeOfSupplyStateCode: "Maharashtra",
  });

  assert.equal(result.ok, true);
  assert.equal(result.data?.placeOfSupplyStateCode, "07");
  assert.equal(result.data?.isInterstate, true);
  assert.deepEqual(result.data?.warnings, []);
});

test("classifySupply falls back to seller state when place of supply is missing", () => {
  const result = classifySupply({
    sellerStateCode: "08",
    buyerGstin: "07ABCDE1234F1Z5",
    shippingStateCode: null,
    billingStateCode: null,
    buyerStateCode: null,
    placeOfSupplyStateCode: null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data?.placeOfSupplyStateCode, "08");
  assert.equal(result.data?.isInterstate, false);
  assert.deepEqual(result.data?.warnings, ["Place of supply missing; defaulted to supplier state"]);
});
