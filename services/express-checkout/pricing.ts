// Single source of truth for how an express-checkout intent's payable total is
// assembled from its money columns. The formula used to be duplicated inline in
// three route handlers (payment-method, discount, intents-create); this module
// centralizes it so a prepaid discount cannot silently drift out of one site.
//
// Money model (all integer paise):
//   total = max(0, subtotal + shipping + codFee − discount − prepaidDiscount)
//
// codFee applies only to COD; prepaidDiscount applies only to a prepaid
// (online) method — they are mutually exclusive in practice. discount is the
// coupon. prepaidDiscount is stored distinctly from discount so COD-advance and
// analytics can tell a prepaid offer apart from a coupon.

export type PrepaidDiscountType = "PERCENTAGE" | "FIXED_AMOUNT";

export type PrepaidDiscountSettings = {
  enabled: boolean;
  type: PrepaidDiscountType;
  // For PERCENTAGE this is a percent (e.g. 15 = 15%); for FIXED_AMOUNT it is paise.
  value: number;
  // Cap on the discount amount in paise (null = uncapped).
  maxPaise: number | null;
  // Minimum product subtotal (paise) required for the offer (null = no minimum).
  minSubtotalPaise: number | null;
};

export type ExpressCheckoutPricingSettings = {
  codFeeAmountPaise: number;
  prepaidDiscount: PrepaidDiscountSettings;
};

export type ExpressPaymentMethod = "COD" | "PREPAID";

/**
 * Compute the prepaid discount (paise) for a given product subtotal. The base
 * is always the product subtotal (merchant-locked), independent of any coupon,
 * so the amount is stable regardless of coupon apply order. Returns 0 when the
 * offer is disabled, below the minimum order, or resolves to nothing.
 */
export function computePrepaidDiscountPaise(input: {
  settings: Pick<ExpressCheckoutPricingSettings, "prepaidDiscount">;
  subtotalAmountPaise: number;
}): number {
  const config = input.settings.prepaidDiscount;
  if (!config || !config.enabled) return 0;

  const subtotalAmountPaise = Math.max(0, Math.floor(Number(input.subtotalAmountPaise || 0)));
  if (subtotalAmountPaise <= 0) return 0;

  const value = Number(config.value || 0);
  if (!(value > 0)) return 0;

  const minSubtotalPaise = config.minSubtotalPaise == null ? null : Math.max(0, Math.floor(Number(config.minSubtotalPaise)));
  if (minSubtotalPaise != null && subtotalAmountPaise < minSubtotalPaise) return 0;

  // PERCENTAGE: percent of the product subtotal (rounded to the nearest paisa).
  // FIXED_AMOUNT: a flat paise figure. Then apply the merchant cap, floor at 0,
  // and never exceed the subtotal itself.
  const rawDiscountPaise = config.type === "PERCENTAGE"
    ? Math.round(subtotalAmountPaise * (value / 100))
    : Math.floor(value);
  const cappedByConfig = config.maxPaise == null
    ? rawDiscountPaise
    : Math.min(rawDiscountPaise, Math.max(0, Math.floor(Number(config.maxPaise))));

  return Math.max(0, Math.min(subtotalAmountPaise, cappedByConfig));
}

/**
 * Resolve the two method-specific money adjustments for a selected payment
 * method: the COD fee (COD only) and the prepaid discount (prepaid only).
 */
export function resolveMethodPricingPaise(input: {
  method: ExpressPaymentMethod;
  settings: ExpressCheckoutPricingSettings;
  subtotalAmountPaise: number;
}): { codFeeAmountPaise: number; prepaidDiscountAmountPaise: number } {
  if (input.method === "COD") {
    return {
      codFeeAmountPaise: Math.max(0, Math.floor(Number(input.settings.codFeeAmountPaise || 0))),
      prepaidDiscountAmountPaise: 0,
    };
  }

  return {
    codFeeAmountPaise: 0,
    prepaidDiscountAmountPaise: computePrepaidDiscountPaise({
      settings: input.settings,
      subtotalAmountPaise: input.subtotalAmountPaise,
    }),
  };
}

/**
 * The canonical payable-total assembly. All total recomputations must route
 * through this so the prepaid term is never dropped.
 */
export function computeExpressCheckoutTotalPaise(input: {
  subtotalAmountPaise: number;
  shippingAmountPaise: number;
  codFeeAmountPaise: number;
  discountAmountPaise: number;
  prepaidDiscountAmountPaise: number;
}): number {
  const subtotal = Math.max(0, Math.floor(Number(input.subtotalAmountPaise || 0)));
  const shipping = Math.max(0, Math.floor(Number(input.shippingAmountPaise || 0)));
  const codFee = Math.max(0, Math.floor(Number(input.codFeeAmountPaise || 0)));
  const discount = Math.max(0, Math.floor(Number(input.discountAmountPaise || 0)));
  const prepaidDiscount = Math.max(0, Math.floor(Number(input.prepaidDiscountAmountPaise || 0)));

  return Math.max(0, subtotal + shipping + codFee - discount - prepaidDiscount);
}
