import { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.ts";

export const MERCHANT_USAGE_TYPES = ["OTP", "EMAIL", "SMS", "WHATSAPP", "AI", "DELIVERY_LOOKUP", "CHECKOUT_TRANSACTION"] as const;
export const MERCHANT_USAGE_ACTIONS = ["OTP_REQUEST", "EMAIL_SEND", "SMS_SEND", "WHATSAPP_SEND", "AI_REQUEST", "DELIVERY_LOOKUP", "CHECKOUT_TRANSACTION"] as const;
export const MERCHANT_USAGE_PROVIDERS = ["PLATFORM_TWILIO", "PLATFORM_RESEND", "PLATFORM_MSG91", "MERCHANT_TWILIO", "MERCHANT_RESEND", "MERCHANT_MSG91", "INTERNAL"] as const;

export type MerchantUsageType = (typeof MERCHANT_USAGE_TYPES)[number];
export type MerchantUsageAction = (typeof MERCHANT_USAGE_ACTIONS)[number];
export type MerchantUsageProvider = (typeof MERCHANT_USAGE_PROVIDERS)[number];

type MerchantUsageDb = Pick<typeof prisma, "shop" | "merchantUsageEvent">;

export type RecordMerchantUsageInput = {
  shopId: string;
  usageType: MerchantUsageType;
  action: MerchantUsageAction;
  provider: MerchantUsageProvider;
  quantity: number | string;
  sourceType: string;
  sourceId: string;
  providerReference?: string | null;
  idempotencyKey: string;
  countryCode?: string | null;
  occurredAt?: Date;
  metadata?: Record<string, unknown> | null;
};

const MAX_METADATA_BYTES = 4096;
const MAX_SUMMARY_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

export class MerchantUsageValidationError extends Error {}
export class MerchantUsageStorageError extends Error {}

function requireValue(value: string | undefined | null, field: string) {
  if (!value || value.trim().length === 0) throw new MerchantUsageValidationError(`${field} is required`);
  return value.trim();
}

function validateEnum<T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  if (!allowed.includes(value)) throw new MerchantUsageValidationError(`${field} is not supported`);
  return value as T[number];
}

function normalizeQuantity(value: number | string) {
  const decimal = new Prisma.Decimal(value);
  if (!decimal.isFinite() || decimal.lte(0)) throw new MerchantUsageValidationError("quantity must be greater than zero");
  return decimal;
}

function validateMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (metadata == null) return null;
  const serialized = JSON.stringify(metadata);
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) throw new MerchantUsageValidationError("metadata exceeds 4 KB");
  return metadata;
}

export async function recordMerchantUsage(input: RecordMerchantUsageInput, db: MerchantUsageDb = prisma): Promise<{ eventId: string; created: boolean }> {
  const shopId = requireValue(input.shopId, "shopId");
  const usageType = validateEnum(input.usageType, MERCHANT_USAGE_TYPES, "usageType");
  const action = validateEnum(input.action, MERCHANT_USAGE_ACTIONS, "action");
  const provider = validateEnum(input.provider, MERCHANT_USAGE_PROVIDERS, "provider");
  const quantity = normalizeQuantity(input.quantity);
  const sourceType = requireValue(input.sourceType, "sourceType");
  const sourceId = requireValue(input.sourceId, "sourceId");
  const idempotencyKey = requireValue(input.idempotencyKey, "idempotencyKey");
  const metadata = validateMetadata(input.metadata);

  const existing = await db.merchantUsageEvent.findUnique({ where: { idempotencyKey }, select: { id: true, shopId: true } });
  if (existing) {
    console.info("[USAGE METER]", { operation: "usage_duplicate", shopId: existing.shopId, eventId: existing.id, created: false });
    return { eventId: existing.id, created: false };
  }

  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { id: true } });
  if (!shop) {
    console.warn("[USAGE METER]", { operation: "usage_shop_unresolved", shopId, usageType, action, provider });
    throw new MerchantUsageValidationError("Unable to resolve shop for usage event");
  }

  try {
    const event = await db.merchantUsageEvent.create({
      data: { shopId, usageType, action, provider, quantity, sourceType, sourceId, providerReference: input.providerReference ?? null, idempotencyKey, countryCode: input.countryCode ?? null, metadata: metadata == null ? undefined : (metadata as Prisma.InputJsonObject), occurredAt: input.occurredAt ?? new Date() },
      select: { id: true, billingStatus: true, countryCode: true },
    });
    console.info("[USAGE METER]", { operation: "usage_recorded", shopId, usageType, action, provider, quantity: quantity.toString(), sourceType, sourceId, eventId: event.id, created: true, billingStatus: event.billingStatus, countryCode: event.countryCode });
    return { eventId: event.id, created: true };
  } catch {
    const afterRace = await db.merchantUsageEvent.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (afterRace) return { eventId: afterRace.id, created: false };
    throw new MerchantUsageStorageError("Unable to record merchant usage event");
  }
}

export async function getMerchantUsageSummary(input: { shopId: string; usageType?: MerchantUsageType; from: Date; to: Date }, db: MerchantUsageDb = prisma): Promise<{ totalQuantity: string; eventCount: number }> {
  const shopId = requireValue(input.shopId, "shopId");
  if (!(input.from instanceof Date) || !(input.to instanceof Date) || input.from >= input.to) throw new MerchantUsageValidationError("valid from/to dates are required");
  if (input.to.getTime() - input.from.getTime() > MAX_SUMMARY_RANGE_MS) throw new MerchantUsageValidationError("usage summary range must be 366 days or less");
  const usageType = input.usageType ? validateEnum(input.usageType, MERCHANT_USAGE_TYPES, "usageType") : undefined;
  const where = { shopId, occurredAt: { gte: input.from, lt: input.to }, ...(usageType ? { usageType } : {}) };
  const [aggregate, eventCount] = await Promise.all([db.merchantUsageEvent.aggregate({ where, _sum: { quantity: true } }), db.merchantUsageEvent.count({ where })]);
  const totalQuantity = aggregate._sum.quantity?.toString() ?? "0";
  console.info("[USAGE METER]", { operation: "usage_summary_loaded", shopId, usageType, eventCount });
  return { totalQuantity, eventCount };
}
