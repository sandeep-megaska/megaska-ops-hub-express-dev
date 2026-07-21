import { prisma } from "../db/prisma";
import { decryptShopifyToken } from "../shopify/token-crypto";
import { getRazorpayConfig } from "../razorpay/config";

export const EXPRESS_CHECKOUT_MODULE_KEY = "express_checkout";
export const EXPRESS_CHECKOUT_NOT_READY = "EXPRESS_CHECKOUT_NOT_READY";
export type ExpressCheckoutReadinessReason = "ready" | "express_checkout_disabled" | "razorpay_not_configured" | "razorpay_invalid";
export type ExpressCheckoutReadiness = { ready: boolean; expressCheckoutEnabled: boolean; provider: "razorpay" | null; providerConfigured: boolean; providerValidated: boolean; reason: ExpressCheckoutReadinessReason };
type Dependencies = { loadEnabled?: (shopId: string) => Promise<boolean>; loadRazorpay?: typeof getRazorpayConfig; validateCredentials?: (keyId: string, keySecret: string) => Promise<boolean> };

async function loadEnabled(shopId: string) {
  const record = await prisma.shopModuleConfig.findUnique({ where: { shopId_moduleKey: { shopId, moduleKey: EXPRESS_CHECKOUT_MODULE_KEY } }, select: { enabled: true } });
  return record?.enabled === true;
}

export async function validateRazorpayCredentials(keyId: string, keySecret: string) {
  const response = await fetch("https://api.razorpay.com/v1/orders?count=1", { method: "GET", headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` }, cache: "no-store" });
  return response.ok;
}

export async function resolveExpressCheckoutReadiness(shopId: string, deps: Dependencies = {}): Promise<ExpressCheckoutReadiness> {
  const [expressCheckoutEnabled, razorpay] = await Promise.all([(deps.loadEnabled || loadEnabled)(shopId), (deps.loadRazorpay || getRazorpayConfig)(shopId)]);
  const keySecret = razorpay.keySecretEncrypted ? decryptShopifyToken(razorpay.keySecretEncrypted) : null;
  const providerConfigured = Boolean(razorpay.enabled && razorpay.keyId && razorpay.keySecretEncrypted);
  let providerValidated = false;
  if (providerConfigured && keySecret) {
    try { providerValidated = await (deps.validateCredentials || validateRazorpayCredentials)(razorpay.keyId, keySecret); } catch { providerValidated = false; }
  }
  const reason: ExpressCheckoutReadinessReason = !expressCheckoutEnabled ? "express_checkout_disabled" : !providerConfigured ? "razorpay_not_configured" : !keySecret || !providerValidated ? "razorpay_invalid" : "ready";
  const result: ExpressCheckoutReadiness = { ready: reason === "ready", expressCheckoutEnabled, provider: providerConfigured ? "razorpay" : null, providerConfigured, providerValidated, reason };
  console.info("express_checkout_readiness_resolved", { shopId, ...result });
  return result;
}

export function toPublicExpressCheckoutConfig(readiness: ExpressCheckoutReadiness) {
  return { enabled: readiness.expressCheckoutEnabled, ready: readiness.ready, provider: readiness.provider, fallback: "shopify_checkout" as const };
}

export async function setExpressCheckoutEnabled(shopId: string, enabled: boolean) {
  if (enabled) {
    const readiness = await resolveExpressCheckoutReadiness(shopId, { loadEnabled: async () => true });
    if (!readiness.ready) {
      console.warn("express_checkout_enable_blocked", { shopId, ...readiness });
      await prisma.shopModuleConfig.upsert({ where: { shopId_moduleKey: { shopId, moduleKey: EXPRESS_CHECKOUT_MODULE_KEY } }, create: { shopId, moduleKey: EXPRESS_CHECKOUT_MODULE_KEY, enabled: false, config: {} }, update: { enabled: false } });
      return { ...readiness, expressCheckoutEnabled: false, ready: false };
    }
  }
  await prisma.shopModuleConfig.upsert({ where: { shopId_moduleKey: { shopId, moduleKey: EXPRESS_CHECKOUT_MODULE_KEY } }, create: { shopId, moduleKey: EXPRESS_CHECKOUT_MODULE_KEY, enabled, config: {} }, update: { enabled } });
  return resolveExpressCheckoutReadiness(shopId);
}
