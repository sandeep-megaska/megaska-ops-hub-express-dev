import test from "node:test";
import assert from "node:assert/strict";
import { addressPricingFingerprint, cartPricingFingerprint, pricingInputFingerprint } from "./pricing-snapshot-fingerprint.ts";

test("canonical fingerprints ignore object key order and normalized whitespace", () => {
  assert.equal(pricingInputFingerprint({ b: " x ", a: 1 }), pricingInputFingerprint({ a: 1, b: "x" }));
});
test("cart fingerprint is stable and changes with quantity", () => {
  const one = [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }];
  assert.equal(cartPricingFingerprint(one), cartPricingFingerprint([...one])); assert.notEqual(cartPricingFingerprint(one), cartPricingFingerprint([{ ...one[0], quantity: 2 }]));
});
test("address fingerprint normalizes pricing fields, changes with postal code, and leaks no raw PII", () => {
  const first = addressPricingFingerprint({ countryCode: " in ", provinceCode: "ka", postalCode: " 560001 ", city: " Bengaluru " });
  assert.equal(first, addressPricingFingerprint({ countryCode: "IN", provinceCode: "KA", postalCode: "560001", city: "bengaluru" }));
  assert.notEqual(first, addressPricingFingerprint({ countryCode: "IN", provinceCode: "KA", postalCode: "560002", city: "bengaluru" }));
  for (const raw of ["560001", "bengaluru", "KA"]) assert.equal(first.includes(raw), false);
  assert.match(first, /^[a-f0-9]{64}$/);
});
