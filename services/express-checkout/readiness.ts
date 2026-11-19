import { prisma } from "../db/prisma";
import { getRazorpayConfig } from "../razorpay/config";

// The "verify the shopper's phone (OTP) before checkout" switch. It is stored as
// the express_checkout module for existing installs. Every order is placed and
// paid on Shopify Checkout; no payment provider is involved.
export const EXPRESS_CHECKOUT_MODULE_KEY = "express_checkout";
export const EXPRESS_CHECKOUT_NOT_READY = "EXPRESS_CHECKOUT_NOT_READY";
export type ExpressCheckoutReadinessReason = "ready" | "express_checkout_disabled";
export type ExpressCheckoutReadiness = { ready: boolean; expressCheckoutEnabled: boolean; codAvailable: boolean; provider: "razorpay" | null; reason: ExpressCheckoutReadinessReason };
type Dependencies = { loadEnabled?: (shopId: string) => Promise<boolean>; loadRazorpay?: typeof getRazorpayConfig };

async function loadEnabled(shopId: string) {
  const record = await prisma.shopModuleConfig.findUnique({ where: { shopId_moduleKey: { shopId, moduleKey: EXPRESS_CHECKOUT_MODULE_KEY } }, select: { enabled: true } });
  return record?.enabled === true;
}

export async function resolveExpressCheckoutReadiness(shopId: string, deps: Dependencies = {}): Promise<ExpressCheckoutReadiness> {
  const [expressCheckoutEnabled, razorpay] = await Promise.all([(deps.loadEnabled || loadEnabled)(shopId), (deps.loadRazorpay || getRazorpayConfig)(shopId)]);
  // Compatibility only: storefront scripts deployed before the Razorpay checkout
  // path was removed engage the OTP gate only when provider is "razorpay". Remove
  // once every store runs the current theme extension (after the move to the
  // public LoopD2C app). Nothing is charged through it.
  const provider = razorpay.enabled && razorpay.keyId && razorpay.keySecretEncrypted ? "razorpay" as const : null;
  return {
    ready: expressCheckoutEnabled,
    expressCheckoutEnabled,
    codAvailable: expressCheckoutEnabled,
    provider,
    reason: expressCheckoutEnabled ? "ready" : "express_checkout_disabled",
  };
}

export function toPublicExpressCheckoutConfig(readiness: ExpressCheckoutReadiness) {
  return { enabled: readiness.expressCheckoutEnabled, ready: readiness.ready, codAvailable: readiness.codAvailable, provider: readiness.provider, fallback: "shopify_checkout" as const };
}

export async function setExpressCheckoutEnabled(shopId: string, enabled: boolean) {
  await prisma.shopModuleConfig.upsert({ where: { shopId_moduleKey: { shopId, moduleKey: EXPRESS_CHECKOUT_MODULE_KEY } }, create: { shopId, moduleKey: EXPRESS_CHECKOUT_MODULE_KEY, enabled, config: {} }, update: { enabled } });
  return resolveExpressCheckoutReadiness(shopId);
}
