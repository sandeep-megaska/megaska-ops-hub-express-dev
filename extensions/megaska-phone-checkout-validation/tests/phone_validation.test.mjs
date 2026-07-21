import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cartValidationsGenerateRun } from "../src/cart_validations_generate_run.js";
import { validateCheckoutPhone } from "../src/phone_validation.js";

const valid = (phone, countryCode, normalizedPhone) =>
  assert.deepEqual(validateCheckoutPhone({ phone, countryCode }), {
    valid: true,
    normalizedPhone,
    reason: null,
  });

test("preserves supported Indian formats and mobile rules", () => {
  for (const phone of ["9539180257", "09539180257", "919539180257", "+91 95391-80257"])
    valid(phone, "IN", "+919539180257");
  assert.equal(validateCheckoutPhone({ phone: "1234567890", countryCode: "IN" }).reason, "INVALID_PHONE");
  assert.equal(validateCheckoutPhone({ phone: "+911234567890", countryCode: "IN" }).reason, "INVALID_PHONE");
  assert.equal(validateCheckoutPhone({ phone: "+96551234567", countryCode: "IN" }).reason, "COUNTRY_MISMATCH");
});

test("accepts country-specific local, E.164, and formatted values", () => {
  valid("51234567", "KW", "+96551234567");
  valid("+965 5123-4567", "KW", "+96551234567");
  valid("050 123 4567", "AE", "+971501234567");
  valid("+971 (50) 123-4567", "AE", "+971501234567");
  valid("(415) 555-2671", "US", "+14155552671");
});

test("rejects an explicit international country mismatch", () => {
  assert.equal(validateCheckoutPhone({ phone: "+919539180257", countryCode: "KW" }).reason, "COUNTRY_MISMATCH");
});

test("does not block a partial checkout without country context", () => {
  const output = cartValidationsGenerateRun({ cart: { buyerIdentity: { phone: "51234567" }, deliveryGroups: [] } });
  assert.deepEqual(output.operations[0].validationAdd.errors, []);
});

test("requires a phone once delivery country is known", () => {
  const output = cartValidationsGenerateRun({
    cart: { buyerIdentity: {}, deliveryGroups: [{ deliveryAddress: { countryCode: "KW", phone: null } }] },
  });
  assert.equal(output.operations[0].validationAdd.errors[0].message, "Enter a mobile number for delivery updates.");
});

test("delivery country takes priority over billing country", () => {
  const output = cartValidationsGenerateRun({
    cart: {
      billingAddress: { countryCode: "IN", phone: "+919539180257" },
      deliveryGroups: [{ deliveryAddress: { countryCode: "KW", phone: "+919539180257" } }],
    },
  });
  assert.equal(output.operations[0].validationAdd.errors[0].message, "Enter a mobile number that matches the selected delivery country.");
});

test("extension remains independent from identity and OTP state", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/phone_validation.js", import.meta.url), "utf8"),
    readFile(new URL("../src/cart_validations_generate_run.js", import.meta.url), "utf8"),
  ]);
  for (const forbidden of ["CustomerProfile", "AuthSession", "OTPChallenge", "MerchantOtpSettings", "phoneE164"])
    assert.doesNotMatch(sources.join("\n"), new RegExp(forbidden));
});
