import assert from "node:assert/strict";
import test from "node:test";

import { cartPaymentMethodsTransformRun } from "../src/cart_payment_methods_transform_run.js";

const cod = { id: "gid://shopify/PaymentCustomizationPaymentMethod/1", name: "Cash on Delivery (COD)" };
const online = { id: "gid://shopify/PaymentCustomizationPaymentMethod/2", name: "UPI / Cards (Razorpay)" };

test("prepaid intent hides COD", () => {
  const out = cartPaymentMethodsTransformRun({ cart: { paymentIntent: { value: "prepaid" } }, paymentMethods: [cod, online] });
  assert.equal(out.operations.length, 1);
  assert.deepEqual(out.operations[0], { paymentMethodHide: { paymentMethodId: cod.id } });
});

test("cod intent keeps every payment method", () => {
  const out = cartPaymentMethodsTransformRun({ cart: { paymentIntent: { value: "cod" } }, paymentMethods: [cod, online] });
  assert.deepEqual(out.operations, []);
});

test("no intent (non-app cart) keeps every method - fail open", () => {
  const out = cartPaymentMethodsTransformRun({ cart: {}, paymentMethods: [cod, online] });
  assert.deepEqual(out.operations, []);
});

test("prepaid with no COD method present is a no-op", () => {
  const out = cartPaymentMethodsTransformRun({ cart: { paymentIntent: { value: "prepaid" } }, paymentMethods: [online] });
  assert.deepEqual(out.operations, []);
});

test("matches common COD names case-insensitively", () => {
  for (const name of ["Cash on Delivery", "cash on delivery (cod)", "COD", "Pay on delivery (COD)"]) {
    const out = cartPaymentMethodsTransformRun({ cart: { paymentIntent: { value: "prepaid" } }, paymentMethods: [{ id: "gid://x/1", name }] });
    assert.equal(out.operations.length, 1, `should hide "${name}"`);
  }
});
