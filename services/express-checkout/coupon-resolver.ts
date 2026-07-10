import type { ExpressCheckoutDiscountDefinition } from "./discounts";
import { resolveLegacyExpressCheckoutCoupon } from "./legacy-coupon-adapter";

type ResolveExpressCheckoutCouponInput = {
  shopId: string;
  shopDomain?: string | null;
  code: string | null;
  cartSnapshot?: unknown;
  rawShopifyPayload?: unknown;
  trustedDefinition?: unknown;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizedCode(code: unknown) {
  const normalized = typeof code === "string" ? code.trim().toUpperCase() : "";
  return normalized || null;
}

function numericValue(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeDefinition(value: unknown, expectedCode: string, source?: ExpressCheckoutDiscountDefinition["source"]) {
  const record = asRecord(value);
  if (!record) return null;

  const code = normalizedCode(record.code ?? record.discountCode);
  const type = record.type === "PERCENTAGE" || record.discountType === "PERCENTAGE"
    ? "PERCENTAGE"
    : record.type === "FIXED_AMOUNT" || record.discountType === "FIXED_AMOUNT"
      ? "FIXED_AMOUNT"
      : null;
  const discountValue = numericValue(record.value ?? record.discountValue ?? record.amountPaise ?? record.amount);
  const valueUnit = record.valueUnit === "PERCENT" || record.valueUnit === "PAISE" ? record.valueUnit : type === "PERCENTAGE" ? "PERCENT" : type === "FIXED_AMOUNT" ? "PAISE" : null;
  const definitionSource = source ?? (record.source as ExpressCheckoutDiscountDefinition["source"] | undefined);

  if (!code || code !== expectedCode || !type || !discountValue || !valueUnit) return null;
  if (!["SHOPIFY", "LOOPDESK_CONFIG", "UPSTREAM_VALIDATED", "LEGACY_COMPATIBILITY"].includes(String(definitionSource))) return null;
  if (type === "PERCENTAGE" && valueUnit !== "PERCENT") return null;
  if (type === "FIXED_AMOUNT" && valueUnit !== "PAISE") return null;

  return {
    code,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Discount",
    type,
    value: discountValue,
    valueUnit,
    source: definitionSource,
    minimumSubtotalPaise: record.minimumSubtotalPaise == null ? null : Math.max(0, Math.floor(Number(record.minimumSubtotalPaise || 0))),
    maximumDiscountPaise: record.maximumDiscountPaise == null ? null : Math.max(0, Math.floor(Number(record.maximumDiscountPaise || 0))),
  } satisfies ExpressCheckoutDiscountDefinition;
}

function normalizeConfiguredDefinition(cartSnapshot: unknown, expectedCode: string) {
  const snapshot = asRecord(cartSnapshot);
  const config = snapshot?.expressCheckoutDiscountDefinitions ?? snapshot?.loopdeskCouponDefinitions;
  const list = Array.isArray(config) ? config : [];

  for (const candidate of list) {
    const definition = normalizeDefinition(candidate, expectedCode, "LOOPDESK_CONFIG");
    if (definition) return definition;
  }

  return null;
}

function normalizeShopifyDefinition(rawShopifyPayload: unknown, expectedCode: string) {
  const payload = asRecord(rawShopifyPayload);
  if (!payload) return null;

  return normalizeDefinition(payload.discountDefinition ?? payload, expectedCode, "SHOPIFY");
}

export async function resolveExpressCheckoutCoupon(input: ResolveExpressCheckoutCouponInput): Promise<ExpressCheckoutDiscountDefinition | null> {
  const code = normalizedCode(input.code);
  if (!code) return null;

  return normalizeDefinition(input.trustedDefinition, code, "UPSTREAM_VALIDATED")
    ?? normalizeConfiguredDefinition(input.cartSnapshot, code)
    ?? normalizeShopifyDefinition(input.rawShopifyPayload, code)
    ?? resolveLegacyExpressCheckoutCoupon({ shopId: input.shopId, shopDomain: input.shopDomain, code });
}
