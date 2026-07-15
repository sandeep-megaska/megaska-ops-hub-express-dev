import { prisma as defaultPrisma } from "../db/prisma.ts";

const DEFAULT_PRICING_PLAN_CODE = "PROFESSIONAL";
const LOG_PREFIX = "[MERCHANT SUBSCRIPTION]";
const MAX_EXTERNAL_REFERENCE_LENGTH = 255;

export const merchantSubscriptionStatuses = ["TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELED", "EXPIRED"] as const;
export const billingProviders = ["SHOPIFY", "STRIPE", "RAZORPAY", "MANUAL", "INTERNAL"] as const;

export type MerchantSubscriptionStatus = (typeof merchantSubscriptionStatuses)[number];
export type BillingProvider = (typeof billingProviders)[number];

export type ResolvedMerchantSubscription = {
  shopId: string;
  subscriptionId: string | null;
  status: MerchantSubscriptionStatus;
  billingProvider: BillingProvider;
  pricingPlan: {
    id: string;
    code: string;
    name: string;
    monthlyBasePrice: string;
    currency: string;
    active: boolean;
  };
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  renewsAutomatically: boolean;
  hasSubscriptionRow: boolean;
};

export type UpsertMerchantSubscriptionInput = {
  pricingPlanCode: unknown;
  status: unknown;
  billingProvider: unknown;
  externalSubscriptionReference?: unknown;
  externalCustomerReference?: unknown;
  trialStartsAt?: unknown;
  trialEndsAt?: unknown;
  currentPeriodStart?: unknown;
  currentPeriodEnd?: unknown;
  renewsAutomatically?: unknown;
  canceledAt?: unknown;
  cancellationEffectiveAt?: unknown;
};

type PricingPlanRecord = { id: string; code: string; name: string; monthlyBasePrice: unknown; currency: string; active: boolean };
type SubscriptionRecord = {
  id: string; shopId: string; status: MerchantSubscriptionStatus; billingProvider: BillingProvider;
  trialStartsAt: Date | null; trialEndsAt: Date | null; currentPeriodStart: Date | null; currentPeriodEnd: Date | null;
  renewsAutomatically: boolean; pricingPlan: PricingPlanRecord;
};

type MerchantSubscriptionPrisma = {
  shop: { findUnique: (args: unknown) => Promise<{ id: string } | null> };
  pricingPlan: { findUnique: (args: unknown) => Promise<PricingPlanRecord | null> };
  merchantSubscription: {
    findUnique: (args: unknown) => Promise<SubscriptionRecord | null>;
    upsert: (args: unknown) => Promise<SubscriptionRecord>;
  };
};

let prismaClient: MerchantSubscriptionPrisma = defaultPrisma as unknown as MerchantSubscriptionPrisma;

export function __setMerchantSubscriptionPrismaForTests(client: MerchantSubscriptionPrisma) {
  prismaClient = client;
}

function log(operation: string, fields: Record<string, unknown>) {
  console.info(LOG_PREFIX, operation, fields);
}

export class MerchantSubscriptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MerchantSubscriptionConfigurationError";
  }
}

export class MerchantSubscriptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MerchantSubscriptionValidationError";
  }
}

function serializePlan(plan: PricingPlanRecord): ResolvedMerchantSubscription["pricingPlan"] {
  return { ...plan, monthlyBasePrice: String(plan.monthlyBasePrice) };
}

function toResolved(row: SubscriptionRecord): ResolvedMerchantSubscription {
  return {
    shopId: row.shopId,
    subscriptionId: row.id,
    status: row.status,
    billingProvider: row.billingProvider,
    pricingPlan: serializePlan(row.pricingPlan),
    trialStartsAt: row.trialStartsAt,
    trialEndsAt: row.trialEndsAt,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    renewsAutomatically: row.renewsAutomatically,
    hasSubscriptionRow: true,
  };
}

async function requireShop(shopId: string) {
  const shop = await prismaClient.shop.findUnique({ where: { id: shopId }, select: { id: true } });
  if (!shop) {
    log("shop_unresolved", { shopId });
    throw new MerchantSubscriptionValidationError("Shop was not found.");
  }
}

async function resolvePlanByCode(code: string, defaultPlan = false) {
  const plan = await prismaClient.pricingPlan.findUnique({ where: { code } });
  if (!plan) {
    log("plan_unresolved", { pricingPlanCode: code });
    const ErrorClass = defaultPlan ? MerchantSubscriptionConfigurationError : MerchantSubscriptionValidationError;
    throw new ErrorClass(defaultPlan ? "Default pricing plan is not configured." : "Pricing plan was not found.");
  }
  if (!plan.active) {
    log("plan_inactive", { pricingPlanCode: code });
    const ErrorClass = defaultPlan ? MerchantSubscriptionConfigurationError : MerchantSubscriptionValidationError;
    throw new ErrorClass(defaultPlan ? "Default pricing plan is inactive." : "Pricing plan is inactive.");
  }
  if (defaultPlan) log("default_resolved", { pricingPlanCode: code });
  return plan;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") throw new MerchantSubscriptionValidationError(`${field} is required.`);
  return value.trim();
}

function parseEnum<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  const parsed = requireString(value, field);
  if (!allowed.includes(parsed)) throw new MerchantSubscriptionValidationError(`${field} is unsupported.`);
  return parsed as T[number];
}

function parseOptionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new MerchantSubscriptionValidationError(`${field} must be a valid date.`);
  return date;
}

function parseOptionalReference(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new MerchantSubscriptionValidationError(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_EXTERNAL_REFERENCE_LENGTH) throw new MerchantSubscriptionValidationError(`${field} is too long.`);
  if (/\p{Cc}/u.test(trimmed)) throw new MerchantSubscriptionValidationError(`${field} contains unsupported characters.`);
  return trimmed;
}

function parseOptionalBoolean(value: unknown) {
  if (value === undefined) return true;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new MerchantSubscriptionValidationError("renewsAutomatically must be a boolean.");
}

export async function getMerchantSubscription(shopId: string): Promise<ResolvedMerchantSubscription> {
  await requireShop(shopId);
  const row = await prismaClient.merchantSubscription.findUnique({ where: { shopId }, include: { pricingPlan: true } });
  if (row) {
    const resolved = toResolved(row);
    log("resolved", { shopId, pricingPlanCode: resolved.pricingPlan.code, status: resolved.status, billingProvider: resolved.billingProvider, hasSubscriptionRow: true });
    return resolved;
  }
  const plan = await resolvePlanByCode(DEFAULT_PRICING_PLAN_CODE, true);
  const resolved: ResolvedMerchantSubscription = {
    shopId,
    subscriptionId: null,
    status: "TRIALING",
    billingProvider: "INTERNAL",
    pricingPlan: serializePlan(plan),
    trialStartsAt: null,
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    renewsAutomatically: true,
    hasSubscriptionRow: false,
  };
  log("resolved", { shopId, pricingPlanCode: plan.code, status: resolved.status, billingProvider: resolved.billingProvider, hasSubscriptionRow: false });
  return resolved;
}

export async function upsertMerchantSubscription(shopId: string, input: UpsertMerchantSubscriptionInput): Promise<ResolvedMerchantSubscription> {
  try {
    await requireShop(shopId);
    const pricingPlanCode = requireString(input.pricingPlanCode, "pricingPlanCode");
    const status = parseEnum(input.status, merchantSubscriptionStatuses, "status");
    const billingProvider = parseEnum(input.billingProvider, billingProviders, "billingProvider");
    const pricingPlan = await resolvePlanByCode(pricingPlanCode);
    const trialStartsAt = parseOptionalDate(input.trialStartsAt, "trialStartsAt");
    const trialEndsAt = parseOptionalDate(input.trialEndsAt, "trialEndsAt");
    const currentPeriodStart = parseOptionalDate(input.currentPeriodStart, "currentPeriodStart");
    const currentPeriodEnd = parseOptionalDate(input.currentPeriodEnd, "currentPeriodEnd");
    const canceledAt = parseOptionalDate(input.canceledAt, "canceledAt");
    const cancellationEffectiveAt = parseOptionalDate(input.cancellationEffectiveAt, "cancellationEffectiveAt");
    if (trialStartsAt && trialEndsAt && trialEndsAt < trialStartsAt) throw new MerchantSubscriptionValidationError("trialEndsAt cannot be before trialStartsAt.");
    if (currentPeriodStart && currentPeriodEnd && currentPeriodEnd <= currentPeriodStart) throw new MerchantSubscriptionValidationError("currentPeriodEnd must be after currentPeriodStart.");
    if (canceledAt && cancellationEffectiveAt && cancellationEffectiveAt < canceledAt) throw new MerchantSubscriptionValidationError("cancellationEffectiveAt cannot be before canceledAt.");
    const data = {
      pricingPlanId: pricingPlan.id,
      status,
      billingProvider,
      externalSubscriptionReference: parseOptionalReference(input.externalSubscriptionReference, "externalSubscriptionReference"),
      externalCustomerReference: parseOptionalReference(input.externalCustomerReference, "externalCustomerReference"),
      trialStartsAt,
      trialEndsAt,
      currentPeriodStart,
      currentPeriodEnd,
      renewsAutomatically: parseOptionalBoolean(input.renewsAutomatically),
      canceledAt,
      cancellationEffectiveAt,
    };
    const existing = await prismaClient.merchantSubscription.findUnique({ where: { shopId }, select: { id: true } });
    const row = await prismaClient.merchantSubscription.upsert({
      where: { shopId },
      create: { shopId, ...data },
      update: data,
      include: { pricingPlan: true },
    });
    log(existing ? "updated" : "created", { shopId, pricingPlanCode, status, billingProvider, hasSubscriptionRow: true, hasExternalSubscriptionReference: data.externalSubscriptionReference !== null, hasExternalCustomerReference: data.externalCustomerReference !== null });
    return toResolved(row);
  } catch (error) {
    if (error instanceof MerchantSubscriptionValidationError) log("validation_rejected", { shopId });
    throw error;
  }
}
