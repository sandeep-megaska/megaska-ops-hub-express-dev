import { prisma } from "../db/prisma";

export const DEFAULT_COD_FEE_AMOUNT_PAISE = 10000;
export const DEFAULT_COD_INFORMATION_TEXT =
  "You need to pay to the delivery agent at the time of delivery. In case of any refund, the refund amount will be issued as Megaska store credit which you can utilize for future purchases. However, for card and UPI payments, the refund amount will be directly transferred to your original payment method.";

const MODULE_KEY = "express_checkout_settings";

type ShopModuleConfigDelegate = {
  findUnique(args: { where: { shopId_moduleKey: { shopId: string; moduleKey: string } } }): Promise<{ config: unknown } | null>;
};

function db() {
  return prisma as unknown as { shopModuleConfig: ShopModuleConfigDelegate };
}

type ExpressCheckoutSettingsConfig = {
  codFeeAmountPaise?: unknown;
  codInformationText?: unknown;
};

function parseConfig(value: unknown): ExpressCheckoutSettingsConfig {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ExpressCheckoutSettingsConfig) : {};
}

export async function getExpressCheckoutSettings(shopId: string) {
  const record = await db().shopModuleConfig.findUnique({
    where: { shopId_moduleKey: { shopId, moduleKey: MODULE_KEY } },
  });
  const config = parseConfig(record?.config);
  const codFeeAmountPaise = Number.isInteger(config.codFeeAmountPaise) && Number(config.codFeeAmountPaise) >= 0
    ? Number(config.codFeeAmountPaise)
    : DEFAULT_COD_FEE_AMOUNT_PAISE;
  const codInformationText = typeof config.codInformationText === "string" && config.codInformationText.trim()
    ? config.codInformationText.trim()
    : DEFAULT_COD_INFORMATION_TEXT;

  return { codFeeAmountPaise, codInformationText };
}
