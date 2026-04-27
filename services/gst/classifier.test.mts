import test from "node:test";
import assert from "node:assert/strict";

import { classifySupply, determinePlaceOfSupply } from "./classifier.ts";

test("determinePlaceOfSupply resolves Shopify province names to GST state code with priority", () => {
  const place = determinePlaceOfSupply({
    shippingStateCode: "Rajasthan",
    billingStateCode: "Delhi",
    buyerStateCode: "Maharashtra",
    placeOfSupplyStateCode: "Karnataka",
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

test("classifySupply falls back to seller state for B2C when place of supply is missing", () => {
  const result = classifySupply({
    sellerStateCode: "08",
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

test("classifySupply returns clear missing place-of-supply error for B2B", () => {
  const result = classifySupply({
    sellerStateCode: "08",
    buyerGstin: "07ABCDE1234F1Z5",
    shippingStateCode: null,
    billingStateCode: null,
    buyerStateCode: null,
    placeOfSupplyStateCode: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "missing placeOfSupplyStateCode");
});
