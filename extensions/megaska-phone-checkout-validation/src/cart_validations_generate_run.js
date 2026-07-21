import { validateCheckoutPhone } from "./phone_validation.js";

const PHONE_FIELD_TARGET = "$.cart.deliveryGroups[0].deliveryAddress.phone";
const MESSAGES = {
  PHONE_REQUIRED: "Enter a mobile number for delivery updates.",
  INVALID_PHONE: "Enter a valid mobile number for the selected country.",
  INVALID_COUNTRY: "Enter a valid mobile number for the selected country.",
  COUNTRY_MISMATCH: "Enter a mobile number that matches the selected delivery country.",
};

function getCheckoutDetails(input) {
  const cart = input?.cart;
  const groups = Array.isArray(cart?.deliveryGroups) ? cart.deliveryGroups : [];

  // Keep the phone and country from the same first delivery address.
  for (const group of groups) {
    const address = group?.deliveryAddress;
    if (address?.countryCode) {
      return {
        countryCode: address.countryCode,
        phone: String(address.phone || cart?.buyerIdentity?.phone || "").trim(),
      };
    }
  }

  const billingAddress = cart?.billingAddress;
  if (billingAddress?.countryCode) {
    return {
      countryCode: billingAddress.countryCode,
      phone: String(billingAddress.phone || cart?.buyerIdentity?.phone || "").trim(),
    };
  }

  const deliveryPhone = groups
    .map((group) => String(group?.deliveryAddress?.phone || "").trim())
    .find(Boolean);
  return {
    countryCode: null,
    phone: deliveryPhone || String(cart?.buyerIdentity?.phone || "").trim(),
  };
}

function validationResult(errors) {
  return { operations: [{ validationAdd: { errors } }] };
}

/** @param {unknown} input */
export function cartValidationsGenerateRun(input) {
  const result = validateCheckoutPhone(getCheckoutDetails(input));

  // Checkout supplies address fields incrementally. Defer until country is known.
  if (result.valid || result.reason === "COUNTRY_REQUIRED") return validationResult([]);

  return validationResult([
    {
      message: MESSAGES[result.reason] || MESSAGES.INVALID_PHONE,
      target: PHONE_FIELD_TARGET,
    },
  ]);
}
