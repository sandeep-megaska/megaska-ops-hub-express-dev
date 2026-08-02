import { prisma } from "../db/prisma";
import { decryptShopifyToken } from "../shopify/token-crypto";
import { getRazorpayConfig } from "../razorpay/config";

export const EXPRESS_CHECKOUT_MODULE_KEY = "express_checkout";
export const EXPRESS_CHECKOUT_NOT_READY = "EXPRESS_CHECKOUT_NOT_READY";
export type ExpressCheckoutReadinessReason = "ready" | "express_checkout_disabled" | "razorpay_not_configured" | "razorpay_invalid";
export type ExpressCheckoutReadiness = { ready: boolean; expressCheckoutEnabled: boolean; codAvailable: boolean; razorpayReady: boolean; provider: "razorpay" | null; providerConfigured: boolean; providerValidated: boolean; reason: ExpressCheckoutReadinessReason };
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
  // COD needs no payment provider, so the express flow can open whenever the
  // module is enabled. Razorpay is only relevant to the legacy in-app prepaid
  // capture (being retired for the Shopify Checkout hand-off) - it no longer
  // gates whether the modal can open. `reason` stays as a Razorpay diagnostic,
  // and `razorpayReady` carries the old strict signal for anything that needs it.
  const razorpayReady = providerConfigured && Boolean(keySecret) && providerValidated;
  const codAvailable = expressCheckoutEnabled;
  const ready = expressCheckoutEnabled;
  const reason: ExpressCheckoutReadinessReason = !expressCheckoutEnabled ? "express_checkout_disabled" : !providerConfigured ? "razorpay_not_configured" : !razorpayReady ? "razorpay_invalid" : "ready";
  const result: ExpressCheckoutReadiness = { ready, expressCheckoutEnabled, codAvailable, razorpayReady, provider: providerConfigured ? "razorpay" : null, providerConfigured, providerValidated, reason };
  console.info("express_checkout_readiness_resolved", { shopId, ...result });
  return result;
}

export function toPublicExpressCheckoutConfig(readiness: ExpressCheckoutReadiness) {
  return { enabled: readiness.expressCheckoutEnabled, ready: readiness.ready, codAvailable: readiness.codAvailable, razorpayReady: readiness.razorpayReady, provider: readiness.provider, fallback: "shopify_checkout" as const };
}

export async function setExpressCheckoutEnabled(shopId: string, enabled: boolean) {
  // Enabling no longer requires Razorpay: COD works with no payment provider, and
  // prepaid is handed off to Shopify Checkout. The legacy in-app prepaid capture
  // still validates credentials at capture time and errors gracefully if absent.
  await prisma.shopModuleConfig.upsert({ where: { shopId_moduleKey: { shopId, moduleKey: EXPRESS_CHECKOUT_MODULE_KEY } }, create: { shopId, moduleKey: EXPRESS_CHECKOUT_MODULE_KEY, enabled, config: {} }, update: { enabled } });
  return resolveExpressCheckoutReadiness(shopId);
}
