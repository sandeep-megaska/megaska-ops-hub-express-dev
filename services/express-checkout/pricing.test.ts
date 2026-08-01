import assert from "node:assert/strict";
import test from "node:test";

import {
  computeExpressCheckoutTotalPaise,
  computePrepaidDiscountPaise,
  resolveMethodPricingPaise,
  type ExpressCheckoutPricingSettings,
} from "./pricing.ts";

const DISABLED: ExpressCheckoutPricingSettings = {
  codFeeAmountPaise: 5000,
  prepaidDiscount: { enabled: false, type: "PERCENTAGE", value: 15, maxPaise: null, minSubtotalPaise: null },
};

function settings(overrides: Partial<ExpressCheckoutPricingSettings["prepaidDiscount"]>, codFeeAmountPaise = 0): ExpressCheckoutPricingSettings {
  return {
    codFeeAmountPaise,
    prepaidDiscount: { enabled: true, type: "PERCENTAGE", value: 15, maxPaise: null, minSubtotalPaise: null, ...overrides },
  };
}

test("total formula subtracts both coupon and prepaid discount, floored at 0", () => {
  assert.equal(
    computeExpressCheckoutTotalPaise({ subtotalAmountPaise: 100000, shippingAmountPaise: 5000, codFeeAmountPaise: 0, discountAmountPaise: 20000, prepaidDiscountAmountPaise: 15000 }),
    70000,
  );
  // COD adds a fee and gets no prepaid discount.
  assert.equal(
    computeExpressCheckoutTotalPaise({ subtotalAmountPaise: 100000, shippingAmountPaise: 5000, codFeeAmountPaise: 5000, discountAmountPaise: 0, prepaidDiscountAmountPaise: 0 }),
    110000,
  );
  // Never negative.
  assert.equal(
    computeExpressCheckoutTotalPaise({ subtotalAmountPaise: 1000, shippingAmountPaise: 0, codFeeAmountPaise: 0, discountAmountPaise: 900, prepaidDiscountAmountPaise: 900 }),
    0,
  );
});

test("percentage prepaid discount on product subtotal", () => {
  // 15% of ₹1000 = ₹150.
  assert.equal(computePrepaidDiscountPaise({ settings: settings({}), subtotalAmountPaise: 100000 }), 15000);
});

test("prepaid discount honours the cap", () => {
  // 15% of ₹2000 = ₹300, capped at ₹200.
  assert.equal(computePrepaidDiscountPaise({ settings: settings({ maxPaise: 20000 }), subtotalAmountPaise: 200000 }), 20000);
});

test("prepaid discount honours the minimum order", () => {
  // Below ₹500 minimum → no offer.
  assert.equal(computePrepaidDiscountPaise({ settings: settings({ minSubtotalPaise: 50000 }), subtotalAmountPaise: 40000 }), 0);
  // At/above minimum → applies.
  assert.equal(computePrepaidDiscountPaise({ settings: settings({ minSubtotalPaise: 50000 }), subtotalAmountPaise: 50000 }), 7500);
});

test("fixed-amount prepaid discount", () => {
  assert.equal(
    computePrepaidDiscountPaise({ settings: settings({ type: "FIXED_AMOUNT", value: 12500 }), subtotalAmountPaise: 100000 }),
    12500,
  );
});

test("disabled offer yields no discount", () => {
  assert.equal(computePrepaidDiscountPaise({ settings: DISABLED, subtotalAmountPaise: 100000 }), 0);
});

test("prepaid discount cannot exceed the subtotal", () => {
  assert.equal(
    computePrepaidDiscountPaise({ settings: settings({ type: "FIXED_AMOUNT", value: 500000 }), subtotalAmountPaise: 100000 }),
    100000,
  );
});

test("resolveMethodPricingPaise splits COD fee and prepaid discount by method", () => {
  const s = settings({ maxPaise: 20000 }, 5000);
  assert.deepEqual(resolveMethodPricingPaise({ method: "COD", settings: s, subtotalAmountPaise: 200000 }), {
    codFeeAmountPaise: 5000,
    prepaidDiscountAmountPaise: 0,
  });
  assert.deepEqual(resolveMethodPricingPaise({ method: "PREPAID", settings: s, subtotalAmountPaise: 200000 }), {
    codFeeAmountPaise: 0,
    prepaidDiscountAmountPaise: 20000,
  });
});

test("COD price is higher than prepaid price for the same cart (the offer's whole point)", () => {
  const s = settings({}, 5000); // 15% prepaid, ₹50 COD fee
  const subtotal = 100000;
  const shipping = 0;
  const discount = 0;
  const cod = resolveMethodPricingPaise({ method: "COD", settings: s, subtotalAmountPaise: subtotal });
  const prepaid = resolveMethodPricingPaise({ method: "PREPAID", settings: s, subtotalAmountPaise: subtotal });
  const codTotal = computeExpressCheckoutTotalPaise({ subtotalAmountPaise: subtotal, shippingAmountPaise: shipping, discountAmountPaise: discount, ...cod });
  const prepaidTotal = computeExpressCheckoutTotalPaise({ subtotalAmountPaise: subtotal, shippingAmountPaise: shipping, discountAmountPaise: discount, ...prepaid });
  assert.equal(codTotal, 105000); // ₹1000 + ₹50 COD fee
  assert.equal(prepaidTotal, 85000); // ₹1000 − ₹150 prepaid
  assert.ok(codTotal > prepaidTotal);
});
