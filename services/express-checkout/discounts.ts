import type { Prisma } from "../../generated/prisma";

export type ExpressCheckoutDiscountCalculation = {
  code: string;
  title: string;
  discountAmountPaise: number;
  rawShopifyPayload: Prisma.InputJsonObject;
};

type CalculateExpressCheckoutDiscountInput = {
  code: string | null;
  couponBaseAmountPaise: number;
  fallbackDiscountAmountPaise?: number;
  rawShopifyPayload?: unknown;
};

function normalizedCouponCode(code: string | null) {
  const normalized = typeof code === "string" ? code.trim().toUpperCase() : "";
  return normalized || null;
}

export function calculateExpressCheckoutDiscount(input: CalculateExpressCheckoutDiscountInput): ExpressCheckoutDiscountCalculation | null {
  const code = normalizedCouponCode(input.code);
  if (!code) return null;

  const couponBaseAmountPaise = Math.max(0, Math.floor(Number(input.couponBaseAmountPaise || 0)));
  const fallbackDiscountAmountPaise = Math.max(0, Math.floor(Number(input.fallbackDiscountAmountPaise || 0)));

  if (code === "MEGA15") {
    const discountAmountPaise = Math.min(
      couponBaseAmountPaise,
      Math.round(couponBaseAmountPaise * 0.15)
    );

    return {
      code,
      title: "15% OFF",
      discountAmountPaise,
      rawShopifyPayload: {
        discountCode: code,
        discountType: "PERCENTAGE",
        discountValue: 15,
        discountAmountPaise,
        source: "megaska_known_coupon",
        upstream: (input.rawShopifyPayload ?? null) as Prisma.InputJsonValue | null,
      },
    };
  }

  if (fallbackDiscountAmountPaise > 0) {
    const discountAmountPaise = Math.min(couponBaseAmountPaise, fallbackDiscountAmountPaise);

    return {
      code,
      title: "Discount",
      discountAmountPaise,
      rawShopifyPayload: {
        discountCode: code,
        discountType: "FIXED_AMOUNT",
        discountValue: discountAmountPaise,
        discountAmountPaise,
        source: "fallback_discount_amount",
        upstream: (input.rawShopifyPayload ?? null) as Prisma.InputJsonValue | null,
      },
    };
  }

  return null;
}
