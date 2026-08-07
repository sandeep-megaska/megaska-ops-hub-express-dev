import { prisma } from "../db/prisma";
import { decryptShopifyToken, encryptShopifyToken } from "../shopify/token-crypto";

export const DELHIVERY_CONFIG_MODULE_KEY = "delhivery_config";
export const DELHIVERY_MASKED_TOKEN = "••••••••";

type DelhiveryEnvironment = "test" | "production";

export type DelhiveryConfig = {
  enabled: boolean;
  environment: DelhiveryEnvironment;
  apiTokenEncrypted: string | null;
  pickupLocation: string;
  originPincode: string;
  // Warehouse registration details (used to auto-create the Delhivery
  // ClientWarehouse named `pickupLocation`, so merchants never touch the portal).
  warehouseEmail: string;
  warehousePhone: string;
  warehouseAddress: string;
  warehouseCity: string;
  warehouseState: string;
  codEnabled: boolean;
  prepaidEnabled: boolean;
  serviceabilityCheckEnabled: boolean;
  defaultPackageWeight: number;
  defaultLength: number;
  defaultBreadth: number;
  defaultHeight: number;
};

export type DelhiveryAdminConfig = Omit<DelhiveryConfig, "apiTokenEncrypted"> & {
  apiTokenMasked: string;
  hasApiToken: boolean;
};

export type DelhiveryInternalConfig = Omit<DelhiveryConfig, "apiTokenEncrypted"> & {
  apiToken: string;
  hasApiToken: boolean;
};

export type DelhiveryPublicRuntimeConfig = Pick<
  DelhiveryConfig,
  | "enabled"
  | "serviceabilityCheckEnabled"
  | "codEnabled"
  | "prepaidEnabled"
  | "originPincode"
>;

type ShopModuleConfigDelegate = {
  findUnique(args: {
    where: { shopId_moduleKey: { shopId: string; moduleKey: string } };
    select: { config: true; enabled?: true };
  }): Promise<{ config: unknown; enabled?: boolean } | null>;
  upsert(args: {
    where: { shopId_moduleKey: { shopId: string; moduleKey: string } };
    create: { shopId: string; moduleKey: string; enabled: boolean; config: DelhiveryConfig };
    update: { enabled: boolean; config: DelhiveryConfig };
  }): Promise<{ id: string; config: unknown; enabled: boolean }>;
};

function db() {
  return prisma as unknown as { shopModuleConfig: ShopModuleConfigDelegate };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function text(value: unknown, fallback = "", max = 120) {
  const next = typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, max) : "";
  return next || fallback;
}
function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}
function positiveNumber(value: unknown, fallback: number, max = 10000) {
  const next = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(next) && next > 0 && next <= max ? next : fallback;
}
function pincode(value: unknown) {
  const next = text(value, "", 6).replace(/\D/g, "");
  return /^\d{6}$/.test(next) ? next : "";
}

export function normalizeDelhiveryConfig(input: unknown): DelhiveryConfig {
  const raw = isRecord(input) ? input : {};
  return {
    enabled: bool(raw.enabled, false),
    environment: raw.environment === "production" ? "production" : "test",
    apiTokenEncrypted: text(raw.apiTokenEncrypted, "", 2000) || null,
    pickupLocation: text(raw.pickupLocation ?? raw.warehouseName, "", 120),
    originPincode: pincode(raw.originPincode),
    warehouseEmail: text(raw.warehouseEmail, "", 254),
    warehousePhone: text(raw.warehousePhone, "", 20),
    warehouseAddress: text(raw.warehouseAddress, "", 255),
    warehouseCity: text(raw.warehouseCity, "", 120),
    warehouseState: text(raw.warehouseState, "", 120),
    codEnabled: bool(raw.codEnabled, false),
    prepaidEnabled: bool(raw.prepaidEnabled, true),
    serviceabilityCheckEnabled: bool(raw.serviceabilityCheckEnabled, true),
    defaultPackageWeight: positiveNumber(raw.defaultPackageWeight, 0.5, 1000),
    defaultLength: positiveNumber(raw.defaultLength, 10, 1000),
    defaultBreadth: positiveNumber(raw.defaultBreadth, 10, 1000),
    defaultHeight: positiveNumber(raw.defaultHeight, 10, 1000),
  };
}

export function validateDelhiveryConfigPatch(patch: unknown) {
  const errors: string[] = [];
  const raw = isRecord(patch) ? patch : {};
  if (raw.environment !== undefined && raw.environment !== "test" && raw.environment !== "production") errors.push("Delhivery environment must be test or production.");
  for (const [key, label] of [["enabled", "Delhivery enabled"], ["codEnabled", "COD enabled"], ["prepaidEnabled", "Prepaid enabled"], ["serviceabilityCheckEnabled", "Pincode serviceability check enabled"]] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") errors.push(`${label} must be true or false.`);
  }
  if (raw.originPincode !== undefined && String(raw.originPincode || "").trim() && !/^\d{6}$/.test(String(raw.originPincode).trim())) errors.push("Origin pincode must be a 6 digit pincode.");
  for (const [key, label] of [["defaultPackageWeight", "Default package weight"], ["defaultLength", "Default length"], ["defaultBreadth", "Default breadth"], ["defaultHeight", "Default height"]] as const) {
    if (raw[key] !== undefined) {
      const next = Number(raw[key]);
      if (!Number.isFinite(next) || next <= 0) errors.push(`${label} must be a positive number.`);
    }
  }
  return errors;
}

export function mergeDelhiveryConfig(current: DelhiveryConfig, patch: unknown) {
  const raw = isRecord(patch) ? patch : {};
  const apiToken = text(raw.apiToken, "", 2000);
  const apiTokenEncrypted = apiToken && apiToken !== DELHIVERY_MASKED_TOKEN ? encryptShopifyToken(apiToken) || apiToken : current.apiTokenEncrypted;
  return normalizeDelhiveryConfig({ ...current, ...raw, apiTokenEncrypted });
}

export function toDelhiveryAdminConfig(config: DelhiveryConfig): DelhiveryAdminConfig {
  const safeConfig = { ...config };
  delete (safeConfig as Partial<DelhiveryConfig>).apiTokenEncrypted;
  const hasApiToken = Boolean(config.apiTokenEncrypted);
  return { ...safeConfig, hasApiToken, apiTokenMasked: hasApiToken ? DELHIVERY_MASKED_TOKEN : "" };
}

export function toDelhiveryPublicRuntimeConfig(config: DelhiveryConfig): DelhiveryPublicRuntimeConfig {
  return {
    enabled: config.enabled,
    serviceabilityCheckEnabled: config.serviceabilityCheckEnabled,
    codEnabled: config.codEnabled,
    prepaidEnabled: config.prepaidEnabled,
    originPincode: config.originPincode,
  };
}

export async function getDelhiveryConfig(shopId: string) {
  const stored = await db().shopModuleConfig.findUnique({
    where: { shopId_moduleKey: { shopId, moduleKey: DELHIVERY_CONFIG_MODULE_KEY } },
    select: { config: true, enabled: true },
  });
  const normalized = normalizeDelhiveryConfig(stored?.config);
  return { ...normalized, enabled: stored?.enabled ?? normalized.enabled };
}
export async function getDelhiveryAdminConfig(shopId: string) {
  return toDelhiveryAdminConfig(await getDelhiveryConfig(shopId));
}
export async function updateDelhiveryConfig(shopId: string, patch: unknown) {
  const errors = validateDelhiveryConfigPatch(patch);
  if (errors.length) throw new Error(errors.join(" "));
  const next = mergeDelhiveryConfig(await getDelhiveryConfig(shopId), patch);
  await db().shopModuleConfig.upsert({
    where: { shopId_moduleKey: { shopId, moduleKey: DELHIVERY_CONFIG_MODULE_KEY } },
    create: { shopId, moduleKey: DELHIVERY_CONFIG_MODULE_KEY, enabled: next.enabled, config: next },
    update: { enabled: next.enabled, config: next },
  });
  return next;
}
export async function getInternalDelhiveryConfig(shopId: string): Promise<DelhiveryInternalConfig> {
  const { apiTokenEncrypted, ...safeConfig } = await getDelhiveryConfig(shopId);
  const apiToken = decryptShopifyToken(apiTokenEncrypted) || apiTokenEncrypted || "";
  return { ...safeConfig, apiToken, hasApiToken: Boolean(apiToken) };
}
export async function getDelhiveryRuntimeConfig(shopId: string) {
  return toDelhiveryPublicRuntimeConfig(await getDelhiveryConfig(shopId));
}
