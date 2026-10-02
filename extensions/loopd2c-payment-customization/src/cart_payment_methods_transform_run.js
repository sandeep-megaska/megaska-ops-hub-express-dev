// Keep Shopify Checkout consistent with the shopper's choice in the LoopD2C cart
// drawer (loopd2c_payment_intent):
// - prepaid: hide Cash on Delivery, so a prepaid-discounted cart can't be paid
//   as COD.
// - cod: hide the online methods. The discount Function only applies the
//   prepaid offer to prepaid carts, so an online method on a COD cart would
//   charge the full price without the offer. A shopper who wants the offer
//   goes back to the drawer and picks Pay Online.
//
// This is what lets BOTH flows finish natively in Shopify Checkout - no COD
// modal. Delivered via a public app, this works on non-Plus plans (COD is a
// manual method, which non-Plus stores may hide/reorder/rename).
//
// Safe by construction: non-app carts (no attribute) keep every payment method,
// and a cart never loses every method - if no COD method is recognised on a COD
// cart, nothing is hidden (fail open).

const NO_CHANGES = { operations: [] };

// COD manual gateways surface with names like "Cash on Delivery (COD)".
const COD_NAME = /cash on delivery|\(cod\)|\bcod\b/i;

/** @param {unknown} input */
export function cartPaymentMethodsTransformRun(input) {
  const intent = String(input?.cart?.paymentIntent?.value || "").trim().toLowerCase();
  if (intent !== "prepaid" && intent !== "cod") return NO_CHANGES;

  const methods = Array.isArray(input?.paymentMethods) ? input.paymentMethods : [];
  const isCod = (method) => COD_NAME.test(String(method?.name || ""));
  if (intent === "cod" && !methods.some(isCod)) return NO_CHANGES;

  const hideCod = intent === "prepaid";
  const operations = methods
    .filter((method) => isCod(method) === hideCod)
    .map((method) => ({ paymentMethodHide: { paymentMethodId: method.id } }));

  return operations.length ? { operations } : NO_CHANGES;
}
