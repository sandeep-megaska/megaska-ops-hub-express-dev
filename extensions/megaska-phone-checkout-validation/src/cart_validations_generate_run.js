import { validateCheckoutPhone } from "./phone_validation.js";

const PHONE_FIELD_TARGET = "$.cart.deliveryGroups[0].deliveryAddress.phone";
const CART_TARGET = "$.cart";
const MESSAGES = {
  PHONE_REQUIRED: "Enter a mobile number for delivery updates.",
  INVALID_PHONE: "Enter a valid mobile number for the selected country.",
  INVALID_COUNTRY: "Enter a valid mobile number for the selected country.",
  COUNTRY_MISMATCH: "Enter a mobile number that matches the selected delivery country.",
  VERIFIED_PHONE_MISMATCH: "Use your verified mobile number for delivery.",
  COD_NOT_AT_CHECKOUT:
    "Cash on Delivery isn't available here. Go back to your cart to place a Cash on Delivery order, or pay online to continue.",
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

// Only the value is needed, and only when the flow actually stamped it. Reading
// a plain cart attribute (not backend state) keeps this Function decoupled from
// identity/OTP internals — see the independence test.
function attributeValue(cart, key) {
  return String(cart?.[key]?.value || "").trim();
}

// Compare two phone strings by their significant digits so E.164, local, and
// formatted variants of the same number match.
function digitsOf(value) {
  return String(value || "").replace(/\D/g, "");
}
function phonesEqual(a, b) {
  const da = digitsOf(a);
  const db = digitsOf(b);
  if (da.length < 10 || db.length < 10) return false;
  // Match on the last 10 significant digits to ignore country-code prefix drift.
  return da.slice(-10) === db.slice(-10);
}

function validationResult(errors) {
  return { operations: [{ validationAdd: { errors } }] };
}

/** @param {unknown} input */
export function cartValidationsGenerateRun(input) {
  const cart = input?.cart;
  const details = getCheckoutDetails(input);
  const result = validateCheckoutPhone(details);

  // Checkout supplies address fields incrementally. Defer until country is known.
  if (result.reason === "COUNTRY_REQUIRED") return validationResult([]);

  const errors = [];

  // Base rule (unchanged): the delivery phone must be valid for its country.
  if (!result.valid) {
    errors.push({
      message: MESSAGES[result.reason] || MESSAGES.INVALID_PHONE,
      target: PHONE_FIELD_TARGET,
    });
  }

  // Migration hardening. These rules only fire when the app's own flow stamped
  // the cart, so non-app checkouts (Buy it Now, Shop Pay, direct /checkout) are
  // never affected — the attributes are simply absent there.
  const verifiedPhone = attributeValue(cart, "verifiedPhone");
  const paymentIntent = attributeValue(cart, "paymentIntent").toLowerCase();

  // A verified prepaid hand-off must keep its verified number: if the delivery
  // phone is otherwise valid but differs from the OTP-verified one, block the
  // swap. Gated on the prepaid intent so the whole rule stays inert until the
  // in-drawer choice flow is live (pre-migration carts carry no payment intent,
  // so behaviour is unchanged). Only enforced when the stamped value is itself a
  // plausible phone (>= 10 digits), so a malformed attribute can never hard-block.
  const hasVerifiedPhone = digitsOf(verifiedPhone).length >= 10;
  if (
    result.valid &&
    paymentIntent === "prepaid" &&
    hasVerifiedPhone &&
    !phonesEqual(result.normalizedPhone, verifiedPhone)
  ) {
    errors.push({ message: MESSAGES.VERIFIED_PHONE_MISMATCH, target: PHONE_FIELD_TARGET });
  }

  // COD is completed in the app's modal (with native COD disabled in payment
  // settings); a COD-intent cart must never finish on Shopify Checkout, where it
  // would take the prepaid price without paying online.
  if (paymentIntent === "cod") {
    errors.push({ message: MESSAGES.COD_NOT_AT_CHECKOUT, target: CART_TARGET });
  }

  return validationResult(errors);
}
