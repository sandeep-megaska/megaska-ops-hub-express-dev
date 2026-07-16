import { prisma as defaultPrisma } from "../db/prisma.ts";

const LOG_PREFIX = "[BILLING PERIOD]";
const MAX_PERIOD_ID_LENGTH = 128;
const MAX_PERIOD_DURATION_MS = 366 * 24 * 60 * 60 * 1000;

export const merchantBillingPeriodStatuses = ["OPEN", "RATING", "RATED", "CLOSED", "VOID"] as const;
export type MerchantBillingPeriodStatus = (typeof merchantBillingPeriodStatuses)[number];

export type ResolvedMerchantBillingPeriod = {
  id: string;
  shopId: string;
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
  status: MerchantBillingPeriodStatus;
  openedAt: Date;
  ratedAt: Date | null;
  closedAt: Date | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OpenBillingPeriodInput = { periodStart: unknown; periodEnd: unknown };

type SubscriptionRecord = { id: string; shopId: string };
type BillingPeriodRecord = ResolvedMerchantBillingPeriod;

type MerchantBillingPeriodPrisma = {
  shop: { findUnique: (args: unknown) => Promise<{ id: string } | null> };
  merchantSubscription: { findUnique: (args: unknown) => Promise<SubscriptionRecord | null> };
  merchantBillingPeriod: {
    findFirst: (args: unknown) => Promise<BillingPeriodRecord | null>;
    findUnique: (args: unknown) => Promise<BillingPeriodRecord | null>;
    create: (args: unknown) => Promise<BillingPeriodRecord>;
    update: (args: unknown) => Promise<BillingPeriodRecord>;
  };
};

let prismaClient: MerchantBillingPeriodPrisma = defaultPrisma as unknown as MerchantBillingPeriodPrisma;

export function __setMerchantBillingPeriodPrismaForTests(client: MerchantBillingPeriodPrisma) {
  prismaClient = client;
}

export class MerchantBillingPeriodValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MerchantBillingPeriodValidationError";
  }
}

export class MerchantBillingPeriodStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MerchantBillingPeriodStateError";
  }
}

function log(operation: string, fields: Record<string, unknown>) {
  console.info(LOG_PREFIX, operation, fields);
}

function toResolved(row: BillingPeriodRecord): ResolvedMerchantBillingPeriod {
  return { ...row };
}

async function requireShop(shopId: string) {
  const shop = await prismaClient.shop.findUnique({ where: { id: shopId }, select: { id: true } });
  if (!shop) {
    log("shop_unresolved", { shopId });
    throw new MerchantBillingPeriodValidationError("SHOP_NOT_FOUND");
  }
}

async function requirePersistedSubscription(shopId: string) {
  const subscription = await prismaClient.merchantSubscription.findUnique({ where: { shopId }, select: { id: true, shopId: true } });
  if (!subscription) {
    log("subscription_missing", { shopId });
    throw new MerchantBillingPeriodValidationError("SUBSCRIPTION_REQUIRED");
  }
  if (subscription.shopId !== shopId) {
    log("ownership_rejected", { shopId, subscriptionId: subscription.id });
    throw new MerchantBillingPeriodValidationError("SUBSCRIPTION_SHOP_MISMATCH");
  }
  return subscription;
}

function parseDate(value: unknown, field: string) {
  const date = value instanceof Date ? new Date(value.getTime()) : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new MerchantBillingPeriodValidationError(`${field} must be a valid date.`);
  return date;
}

function parseRange(input: OpenBillingPeriodInput) {
  const periodStart = parseDate(input.periodStart, "periodStart");
  const periodEnd = parseDate(input.periodEnd, "periodEnd");
  if (periodEnd.getTime() <= periodStart.getTime()) throw new MerchantBillingPeriodValidationError("periodEnd must be after periodStart.");
  if (periodEnd.getTime() - periodStart.getTime() > MAX_PERIOD_DURATION_MS) throw new MerchantBillingPeriodValidationError("Billing period cannot exceed 366 days.");
  return { periodStart, periodEnd };
}

function parsePeriodId(value: string) {
  if (typeof value !== "string") throw new MerchantBillingPeriodValidationError("billingPeriodId is required.");
  const id = value.trim();
  if (!id) throw new MerchantBillingPeriodValidationError("billingPeriodId is required.");
  if (id.length > MAX_PERIOD_ID_LENGTH) throw new MerchantBillingPeriodValidationError("billingPeriodId is too long.");
  if (/\p{Cc}/u.test(id)) throw new MerchantBillingPeriodValidationError("billingPeriodId contains unsupported characters.");
  return id;
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

async function findExact(subscriptionId: string, periodStart: Date, periodEnd: Date) {
  return prismaClient.merchantBillingPeriod.findUnique({
    where: { subscriptionId_periodStart_periodEnd: { subscriptionId, periodStart, periodEnd } },
  });
}

async function findOverlap(subscriptionId: string, periodStart: Date, periodEnd: Date) {
  return prismaClient.merchantBillingPeriod.findFirst({
    where: { subscriptionId, status: { not: "VOID" }, periodStart: { lt: periodEnd }, periodEnd: { gt: periodStart } },
    orderBy: { periodStart: "asc" },
  });
}

export async function getCurrentBillingPeriod(shopId: string, at: Date = new Date()): Promise<ResolvedMerchantBillingPeriod | null> {
  await requireShop(shopId);
  const subscription = await prismaClient.merchantSubscription.findUnique({ where: { shopId }, select: { id: true, shopId: true } });
  if (!subscription) {
    log("current_missing", { shopId });
    return null;
  }
  const instant = parseDate(at, "at");
  const period = await prismaClient.merchantBillingPeriod.findFirst({
    where: { shopId, subscriptionId: subscription.id, status: { not: "VOID" }, periodStart: { lte: instant }, periodEnd: { gt: instant } },
    orderBy: { periodStart: "desc" },
  });
  if (!period) {
    log("current_missing", { shopId, subscriptionId: subscription.id });
    return null;
  }
  log("current_resolved", { shopId, subscriptionId: subscription.id, billingPeriodId: period.id, status: period.status, periodStart: period.periodStart, periodEnd: period.periodEnd });
  return toResolved(period);
}

export async function openMerchantBillingPeriod(shopId: string, input: OpenBillingPeriodInput): Promise<ResolvedMerchantBillingPeriod> {
  try {
    await requireShop(shopId);
    const subscription = await requirePersistedSubscription(shopId);
    const { periodStart, periodEnd } = parseRange(input);
    const existing = await findExact(subscription.id, periodStart, periodEnd);
    if (existing && existing.status !== "VOID") {
      log("duplicate_resolved", { shopId, subscriptionId: subscription.id, billingPeriodId: existing.id, status: existing.status, periodStart, periodEnd });
      return toResolved(existing);
    }
    const overlap = await findOverlap(subscription.id, periodStart, periodEnd);
    if (overlap) {
      log("overlap_rejected", { shopId, subscriptionId: subscription.id, billingPeriodId: overlap.id, periodStart, periodEnd });
      throw new MerchantBillingPeriodValidationError("BILLING_PERIOD_OVERLAP");
    }
    try {
      const period = await prismaClient.merchantBillingPeriod.create({ data: { shopId, subscriptionId: subscription.id, periodStart, periodEnd, status: "OPEN" } });
      log("opened", { shopId, subscriptionId: subscription.id, billingPeriodId: period.id, status: period.status, periodStart, periodEnd });
      return toResolved(period);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const duplicate = await findExact(subscription.id, periodStart, periodEnd);
      if (duplicate) {
        log("duplicate_resolved", { shopId, subscriptionId: subscription.id, billingPeriodId: duplicate.id, status: duplicate.status, periodStart, periodEnd });
        return toResolved(duplicate);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof MerchantBillingPeriodValidationError) log("validation_rejected", { shopId });
    throw error;
  }
}

export async function closeMerchantBillingPeriod(shopId: string, billingPeriodId: string): Promise<ResolvedMerchantBillingPeriod> {
  const id = parsePeriodId(billingPeriodId);
  const period = await prismaClient.merchantBillingPeriod.findUnique({ where: { id } });
  if (!period || period.shopId !== shopId) {
    log("ownership_rejected", { shopId, billingPeriodId: id });
    throw new MerchantBillingPeriodValidationError("BILLING_PERIOD_NOT_FOUND");
  }
  if (period.status === "CLOSED") return toResolved(period);
  if (period.status !== "OPEN") throw new MerchantBillingPeriodStateError("Only OPEN billing periods may be closed in this phase; later rating integration may require RATED before CLOSED.");
  const closed = await prismaClient.merchantBillingPeriod.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
  log("closed", { shopId, subscriptionId: closed.subscriptionId, billingPeriodId: closed.id, status: closed.status, periodStart: closed.periodStart, periodEnd: closed.periodEnd });
  return toResolved(closed);
}

export async function voidMerchantBillingPeriod(shopId: string, billingPeriodId: string): Promise<ResolvedMerchantBillingPeriod> {
  const id = parsePeriodId(billingPeriodId);
  const period = await prismaClient.merchantBillingPeriod.findUnique({ where: { id } });
  if (!period || period.shopId !== shopId) {
    log("ownership_rejected", { shopId, billingPeriodId: id });
    throw new MerchantBillingPeriodValidationError("BILLING_PERIOD_NOT_FOUND");
  }
  if (period.status === "VOID") return toResolved(period);
  if (period.status !== "OPEN") throw new MerchantBillingPeriodStateError("Only OPEN billing periods may be voided.");
  const voided = await prismaClient.merchantBillingPeriod.update({ where: { id }, data: { status: "VOID", voidedAt: new Date() } });
  log("voided", { shopId, subscriptionId: voided.subscriptionId, billingPeriodId: voided.id, status: voided.status, periodStart: voided.periodStart, periodEnd: voided.periodEnd });
  return toResolved(voided);
}
