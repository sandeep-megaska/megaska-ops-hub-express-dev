import type { PrepaidDiscountSettings, PrepaidDiscountType } from "./pricing";

export const DEFAULT_COD_FEE_AMOUNT_PAISE = 0;
export const DEFAULT_COD_INFORMATION_TEXT =
  "You need to pay to the delivery agent at the time of delivery. In case of any refund, the refund amount will be issued as store credit which you can utilize for future purchases. However, for card and UPI payments, the refund amount will be directly transferred to your original payment method.";

export const DEFAULT_PREPAID_DISCOUNT: PrepaidDiscountSettings = {
  enabled: false,
  type: "PERCENTAGE",
  value: 0,
  maxPaise: null,
  minSubtotalPaise: null,
  offerMessage: null,
};

const MODULE_KEY = "express_checkout_settings";

type ShopModuleConfigDelegate = {
  findUnique(args: { where: { shopId_moduleKey: { shopId: string; moduleKey: string } } }): Promise<{ config: unknown } | null>;
};

type ExpressCheckoutSettingsDb = { shopModuleConfig: ShopModuleConfigDelegate };

async function db() {
  const mod = await import("../db/prisma");
  return mod.prisma as unknown as ExpressCheckoutSettingsDb;
}

type ExpressCheckoutSettingsConfig = {
  codFeeAmountPaise?: unknown;
  codInformationText?: unknown;
  prepaidDiscountEnabled?: unknown;
  prepaidDiscountType?: unknown;
  prepaidDiscountValue?: unknown;
  prepaidDiscountMaxPaise?: unknown;
  prepaidDiscountMinSubtotalPaise?: unknown;
  prepaidOfferMessage?: unknown;
};

const PREPAID_OFFER_MESSAGE_MAX_LENGTH = 160;

export function parseCodFeeRupeesToPaise(value: unknown) {
  if (value == null) return 0;
  const normalized = String(value).trim();
  if (normalized === "") return 0;
  if (!/^(?:\d+|\d+\.\d{1,2})$/.test(normalized)) return null;

  const [rupeesPart, paisePart = ""] = normalized.split(".");
  const paise = Number(rupeesPart) * 100 + Number(paisePart.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

// Reuses the rupees→paise parser; a null return signals an invalid amount.
export const parseRupeesToPaise = parseCodFeeRupeesToPaise;

/**
 * Parse a percentage input (0–100, up to two decimals) into a whole-or-fractional
 * percent number. Returns null for malformed input, 0 for empty.
 */
export function parsePercentValue(value: unknown) {
  if (value == null) return 0;
  const normalized = String(value).trim();
  if (normalized === "") return 0;
  if (!/^(?:\d+|\d+\.\d{1,2})$/.test(normalized)) return null;
  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return percent;
}

function parseConfig(value: unknown): ExpressCheckoutSettingsConfig {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ExpressCheckoutSettingsConfig) : {};
}

function nonNegativeInt(value: unknown, fallback: number) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function optionalNonNegativeInt(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function parsePrepaidDiscount(config: ExpressCheckoutSettingsConfig): PrepaidDiscountSettings {
  const type: PrepaidDiscountType = config.prepaidDiscountType === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
  const rawValue = Number(config.prepaidDiscountValue);
  const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0;
  const enabled = config.prepaidDiscountEnabled === true && value > 0;

  const offerMessageRaw = typeof config.prepaidOfferMessage === "string" ? config.prepaidOfferMessage.trim() : "";
  const offerMessage = offerMessageRaw ? offerMessageRaw.slice(0, PREPAID_OFFER_MESSAGE_MAX_LENGTH) : null;

  return {
    enabled,
    type,
    value,
    maxPaise: optionalNonNegativeInt(config.prepaidDiscountMaxPaise),
    minSubtotalPaise: optionalNonNegativeInt(config.prepaidDiscountMinSubtotalPaise),
    offerMessage,
  };
}

export async function getExpressCheckoutSettings(shopId: string, deps: { db?: ExpressCheckoutSettingsDb } = {}) {
  const record = await (deps.db || await db()).shopModuleConfig.findUnique({
    where: { shopId_moduleKey: { shopId, moduleKey: MODULE_KEY } },
  });
  const config = parseConfig(record?.config);
  const codFeeAmountPaise = nonNegativeInt(config.codFeeAmountPaise, DEFAULT_COD_FEE_AMOUNT_PAISE);
  const codInformationText = typeof config.codInformationText === "string" && config.codInformationText.trim()
    ? config.codInformationText.trim()
    : DEFAULT_COD_INFORMATION_TEXT;
  const prepaidDiscount = parsePrepaidDiscount(config);

  return { codFeeAmountPaise, codInformationText, prepaidDiscount };
}
