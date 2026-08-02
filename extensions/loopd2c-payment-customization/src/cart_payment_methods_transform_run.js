// Hide Cash on Delivery at Shopify Checkout when the shopper chose "Pay Online"
// in the LoopD2C cart drawer (loopd2c_payment_intent = prepaid).
//
// This is what lets BOTH flows finish natively in Shopify Checkout - no COD
// modal. The discount Function only applies the prepaid discount to prepaid
// carts, so hiding COD on those carts keeps COD orders (cod-intent) at full
// price and stops a prepaid-discounted cart from being paid as COD. Delivered
// via a public app, this works on non-Plus plans (COD is a manual method, which
// non-Plus stores may hide/reorder/rename).
//
// Safe by construction: only a cart the drawer explicitly marked "prepaid" has
// COD hidden. COD-intent carts and non-app carts (no attribute) keep every
// payment method - fail open.

const NO_CHANGES = { operations: [] };

// COD manual gateways surface with names like "Cash on Delivery (COD)".
const COD_NAME = /cash on delivery|\(cod\)|\bcod\b/i;

/** @param {unknown} input */
export function cartPaymentMethodsTransformRun(input) {
  const intent = String(input?.cart?.paymentIntent?.value || "").trim().toLowerCase();
  if (intent !== "prepaid") return NO_CHANGES;

  const methods = Array.isArray(input?.paymentMethods) ? input.paymentMethods : [];
  const operations = methods
    .filter((method) => COD_NAME.test(String(method?.name || "")))
    .map((method) => ({ paymentMethodHide: { paymentMethodId: method.id } }));

  return operations.length ? { operations } : NO_CHANGES;
}
