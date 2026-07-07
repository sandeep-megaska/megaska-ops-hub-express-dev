import { prisma } from "../db/prisma";
import { decryptShopifyToken, encryptShopifyToken } from "../shopify/token-crypto";

export const RAZORPAY_CONFIG_MODULE_KEY = "razorpay_config";
export const RAZORPAY_MASKED_SECRET = "••••••••";

type RazorpayEnvironment = "test" | "production";
type RazorpayCaptureMode = "automatic" | "manual";

export type RazorpayConfig = {
  enabled: boolean;
  environment: RazorpayEnvironment;
  keyId: string;
  keySecretEncrypted: string | null;
  webhookSecretEncrypted: string | null;
  currency: string;
  captureMode: RazorpayCaptureMode;
  upiEnabled: boolean;
  cardsEnabled: boolean;
  netBankingEnabled: boolean;
  walletsEnabled: boolean;
  codFallbackEnabled: boolean;
};

export type RazorpayAdminConfig = Omit<RazorpayConfig, "keySecretEncrypted" | "webhookSecretEncrypted"> & {
  keySecretMasked: string;
  webhookSecretMasked: string;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
};

export type RazorpayInternalConfig = Omit<RazorpayConfig, "keySecretEncrypted" | "webhookSecretEncrypted"> & {
  keySecret: string;
  webhookSecret: string;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
};

export type RazorpayPublicRuntimeConfig = Pick<RazorpayConfig, "enabled" | "environment" | "keyId" | "currency" | "upiEnabled" | "cardsEnabled" | "netBankingEnabled" | "walletsEnabled" | "codFallbackEnabled">;

type ShopModuleConfigDelegate = {
  findUnique(args: { where: { shopId_moduleKey: { shopId: string; moduleKey: string } }; select: { config: true; enabled?: true } }): Promise<{ config: unknown; enabled?: boolean } | null>;
  upsert(args: { where: { shopId_moduleKey: { shopId: string; moduleKey: string } }; create: { shopId: string; moduleKey: string; enabled: boolean; config: RazorpayConfig }; update: { enabled: boolean; config: RazorpayConfig } }): Promise<{ id: string; config: unknown; enabled: boolean }>;
};

function db() { return prisma as unknown as { shopModuleConfig: ShopModuleConfigDelegate }; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function text(value: unknown, fallback = "", max = 240) { const next = typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, max) : ""; return next || fallback; }
function bool(value: unknown, fallback: boolean) { return typeof value === "boolean" ? value : fallback; }
function currency(value: unknown) { const next = text(value, "INR", 3).toUpperCase(); return /^[A-Z]{3}$/.test(next) ? next : "INR"; }

export function normalizeRazorpayConfig(input: unknown): RazorpayConfig {
  const raw = isRecord(input) ? input : {};
  return {
    enabled: bool(raw.enabled, false),
    environment: raw.environment === "production" ? "production" : "test",
    keyId: text(raw.keyId, "", 120),
    keySecretEncrypted: text(raw.keySecretEncrypted, "", 2000) || null,
    webhookSecretEncrypted: text(raw.webhookSecretEncrypted, "", 2000) || null,
    currency: currency(raw.currency),
    captureMode: raw.captureMode === "manual" ? "manual" : "automatic",
    upiEnabled: bool(raw.upiEnabled, true),
    cardsEnabled: bool(raw.cardsEnabled, true),
    netBankingEnabled: bool(raw.netBankingEnabled, true),
    walletsEnabled: bool(raw.walletsEnabled, true),
    codFallbackEnabled: bool(raw.codFallbackEnabled, false),
  };
}

export function validateRazorpayConfigPatch(patch: unknown) {
  const errors: string[] = [];
  const raw = isRecord(patch) ? patch : {};
  if (raw.environment !== undefined && raw.environment !== "test" && raw.environment !== "production") errors.push("Razorpay environment must be test or production.");
  if (raw.captureMode !== undefined && raw.captureMode !== "automatic" && raw.captureMode !== "manual") errors.push("Razorpay capture mode must be automatic or manual.");
  for (const [key, label] of [["enabled", "Razorpay enabled"], ["upiEnabled", "UPI enabled"], ["cardsEnabled", "Cards enabled"], ["netBankingEnabled", "Net Banking enabled"], ["walletsEnabled", "Wallets enabled"], ["codFallbackEnabled", "COD fallback enabled"]] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") errors.push(`${label} must be true or false.`);
  }
  if (raw.currency !== undefined && String(raw.currency || "").trim() && !/^[A-Za-z]{3}$/.test(String(raw.currency).trim())) errors.push("Currency must be a 3-letter ISO currency code.");
  return errors;
}

export function mergeRazorpayConfig(current: RazorpayConfig, patch: unknown) {
  const raw = isRecord(patch) ? patch : {};
  const keySecret = text(raw.keySecret, "", 2000);
  const webhookSecret = text(raw.webhookSecret, "", 2000);
  const keySecretEncrypted = keySecret && keySecret !== RAZORPAY_MASKED_SECRET ? encryptShopifyToken(keySecret) || keySecret : current.keySecretEncrypted;
  const webhookSecretEncrypted = webhookSecret && webhookSecret !== RAZORPAY_MASKED_SECRET ? encryptShopifyToken(webhookSecret) || webhookSecret : current.webhookSecretEncrypted;
  return normalizeRazorpayConfig({ ...current, ...raw, keySecretEncrypted, webhookSecretEncrypted });
}

export function toRazorpayAdminConfig(config: RazorpayConfig): RazorpayAdminConfig {
  const safeConfig = { ...config };
  delete (safeConfig as Partial<RazorpayConfig>).keySecretEncrypted;
  delete (safeConfig as Partial<RazorpayConfig>).webhookSecretEncrypted;
  const hasKeySecret = Boolean(config.keySecretEncrypted);
  const hasWebhookSecret = Boolean(config.webhookSecretEncrypted);
  return { ...safeConfig, hasKeySecret, hasWebhookSecret, keySecretMasked: hasKeySecret ? RAZORPAY_MASKED_SECRET : "", webhookSecretMasked: hasWebhookSecret ? RAZORPAY_MASKED_SECRET : "" };
}

export function toRazorpayPublicRuntimeConfig(config: RazorpayConfig): RazorpayPublicRuntimeConfig {
  return { enabled: config.enabled, environment: config.environment, keyId: config.keyId, currency: config.currency, upiEnabled: config.upiEnabled, cardsEnabled: config.cardsEnabled, netBankingEnabled: config.netBankingEnabled, walletsEnabled: config.walletsEnabled, codFallbackEnabled: config.codFallbackEnabled };
}

export async function getRazorpayConfig(shopId: string) {
  const stored = await db().shopModuleConfig.findUnique({ where: { shopId_moduleKey: { shopId, moduleKey: RAZORPAY_CONFIG_MODULE_KEY } }, select: { config: true, enabled: true } });
  const normalized = normalizeRazorpayConfig(stored?.config);
  return { ...normalized, enabled: stored?.enabled ?? normalized.enabled };
}
export async function getRazorpayAdminConfig(shopId: string) { return toRazorpayAdminConfig(await getRazorpayConfig(shopId)); }
export async function updateRazorpayConfig(shopId: string, patch: unknown) {
  const errors = validateRazorpayConfigPatch(patch);
  if (errors.length) throw new Error(errors.join(" "));
  const next = mergeRazorpayConfig(await getRazorpayConfig(shopId), patch);
  await db().shopModuleConfig.upsert({ where: { shopId_moduleKey: { shopId, moduleKey: RAZORPAY_CONFIG_MODULE_KEY } }, create: { shopId, moduleKey: RAZORPAY_CONFIG_MODULE_KEY, enabled: next.enabled, config: next }, update: { enabled: next.enabled, config: next } });
  return next;
}
export async function getInternalRazorpayConfig(shopId: string): Promise<RazorpayInternalConfig> {
  const { keySecretEncrypted, webhookSecretEncrypted, ...safeConfig } = await getRazorpayConfig(shopId);
  const keySecret = decryptShopifyToken(keySecretEncrypted) || keySecretEncrypted || "";
  const webhookSecret = decryptShopifyToken(webhookSecretEncrypted) || webhookSecretEncrypted || "";
  return { ...safeConfig, keySecret, webhookSecret, hasKeySecret: Boolean(keySecret), hasWebhookSecret: Boolean(webhookSecret) };
}
export async function getRazorpayRuntimeConfig(shopId: string) { return toRazorpayPublicRuntimeConfig(await getRazorpayConfig(shopId)); }
