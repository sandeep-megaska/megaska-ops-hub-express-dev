import type { Prisma } from "../../generated/prisma";

export type ExpressCheckoutDiscountDefinition = {
  code: string;
  title: string;
  type: "PERCENTAGE" | "FIXED_AMOUNT";
  value: number;
  valueUnit: "PERCENT" | "PAISE";
  source: "SHOPIFY" | "LOOPDESK_CONFIG" | "UPSTREAM_VALIDATED" | "LEGACY_COMPATIBILITY";
  minimumSubtotalPaise?: number | null;
  maximumDiscountPaise?: number | null;
};

export type ExpressCheckoutDiscountCalculation = {
  code: string;
  title: string;
  discountAmountPaise: number;
  rawShopifyPayload: Prisma.InputJsonObject;
};

type CalculateExpressCheckoutDiscountInput = {
  definition: ExpressCheckoutDiscountDefinition;
  couponBaseAmountPaise: number;
  rawShopifyPayload?: unknown;
};

function normalizedCouponCode(code: string | null) {
  const normalized = typeof code === "string" ? code.trim().toUpperCase() : "";
  return normalized || null;
}

function normalizedDefinition(input: ExpressCheckoutDiscountDefinition) {
  const code = normalizedCouponCode(input.code);
  const value = Number(input.value);

  if (!code || !Number.isFinite(value) || value <= 0) return null;
  if (input.type === "PERCENTAGE" && input.valueUnit !== "PERCENT") return null;
  if (input.type === "FIXED_AMOUNT" && input.valueUnit !== "PAISE") return null;

  return { ...input, code, value };
}

export function calculateExpressCheckoutDiscount(input: CalculateExpressCheckoutDiscountInput): ExpressCheckoutDiscountCalculation | null {
  const definition = normalizedDefinition(input.definition);
  if (!definition) return null;

  const couponBaseAmountPaise = Math.max(0, Math.floor(Number(input.couponBaseAmountPaise || 0)));
  const minimumSubtotalPaise = definition.minimumSubtotalPaise == null ? null : Math.max(0, Math.floor(Number(definition.minimumSubtotalPaise || 0)));

  if (minimumSubtotalPaise != null && couponBaseAmountPaise < minimumSubtotalPaise) return null;

  const rawDiscountAmountPaise = definition.type === "PERCENTAGE"
    ? Math.round(couponBaseAmountPaise * (definition.value / 100))
    : Math.floor(definition.value);
  const cappedByDefinition = definition.maximumDiscountPaise == null
    ? rawDiscountAmountPaise
    : Math.min(rawDiscountAmountPaise, Math.max(0, Math.floor(Number(definition.maximumDiscountPaise || 0))));
  const discountAmountPaise = Math.min(couponBaseAmountPaise, Math.max(0, cappedByDefinition));

  if (discountAmountPaise <= 0) return null;

  return {
    code: definition.code,
    title: definition.title || "Discount",
    discountAmountPaise,
    rawShopifyPayload: {
      discountCode: definition.code,
      discountType: definition.type,
      discountValue: definition.value,
      discountAmountPaise,
      source: definition.source,
      upstream: (input.rawShopifyPayload ?? null) as Prisma.InputJsonValue | null,
    },
  };
}
