import { Prisma } from "../../generated/prisma/index.js";
import { prisma as defaultPrisma } from "../db/prisma.ts";
import type {
  BillingFeatureUsageSummary,
  BillingMoney,
  BillingPeriodSummaryPage,
  MerchantBillingPeriodSummary,
  MerchantSubscriptionSummary,
} from "./billing-summary.types.ts";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["TRIALING", "ACTIVE", "PAST_DUE"]);

type Plan = { id: string; code: string; name: string; currency: string; monthlyBasePrice: unknown };
type Subscription = { id: string; shopId: string; status: string; billingProvider: string | null; createdAt: Date; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; canceledAt: Date | null; cancellationEffectiveAt: Date | null; pricingPlan: Plan };
type RatedUsage = { id: string; shopId: string; billingPeriodId: string; billableFeatureId: string; featureCodeSnapshot: string; featureNameSnapshot: string | null; currency: string; usedQuantity: unknown; includedQuantity: unknown; billableQuantity: unknown; unitRate: unknown; amount: unknown; usageEventCount: number };
type Period = { id: string; shopId: string; subscriptionId: string; periodStart: Date; periodEnd: Date; status: string; subscription: Subscription; ratedUsages: RatedUsage[] };
type SummaryDb = {
  merchantSubscription: { findFirst(args: unknown): Promise<Subscription | null> };
  merchantBillingPeriod: { findFirst(args: unknown): Promise<Period | null>; findMany(args: unknown): Promise<Period[]> };
};

let prismaClient: SummaryDb = defaultPrisma as unknown as SummaryDb;

/** Test-only dependency injection; production summary operations are read-only Prisma queries. */
export function __setBillingSummaryPrismaForTests(client: SummaryDb) {
  prismaClient = client;
}

export class BillingCurrencyMismatchError extends Error {
  constructor(message: string) { super(message); this.name = "BillingCurrencyMismatchError"; }
}

export class BillingSummaryInvariantError extends Error {
  constructor(message: string) { super(message); this.name = "BillingSummaryInvariantError"; }
}

function decimal(value: unknown) { return new Prisma.Decimal((value ?? 0) as Prisma.Decimal.Value); }
function money(currency: string, amount: Prisma.Decimal.Value): BillingMoney { return { currency, amount: decimal(amount).toString() }; }
function iso(value: Date | null) { return value?.toISOString() ?? null; }

function subscriptionIsActiveAt(subscription: Subscription, asOf: Date) {
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) return false;
  if (subscription.currentPeriodStart && subscription.currentPeriodStart > asOf) return false;
  if (subscription.currentPeriodEnd && subscription.currentPeriodEnd <= asOf) return false;
  const effectiveEnd = subscription.cancellationEffectiveAt ?? subscription.canceledAt;
  return !effectiveEnd || effectiveEnd > asOf;
}

function toSubscriptionSummary(subscription: Subscription): MerchantSubscriptionSummary {
  return {
    subscriptionId: subscription.id, status: subscription.status, provider: subscription.billingProvider,
    planId: subscription.pricingPlan.id, planCode: subscription.pricingPlan.code, planName: subscription.pricingPlan.name,
    currency: subscription.pricingPlan.currency, monthlyBasePrice: decimal(subscription.pricingPlan.monthlyBasePrice).toString(),
    startedAt: subscription.createdAt.toISOString(), currentPeriodStart: iso(subscription.currentPeriodStart), currentPeriodEnd: iso(subscription.currentPeriodEnd),
  };
}

function assertCurrency(expected: string, actual: string, context: string) {
  if (expected !== actual) throw new BillingCurrencyMismatchError(`Billing currency mismatch for ${context}: expected ${expected}, received ${actual}.`);
}

function toFeature(row: RatedUsage, currency: string): BillingFeatureUsageSummary {
  assertCurrency(currency, row.currency, `feature ${row.featureCodeSnapshot}`);
  return {
    featureId: row.billableFeatureId, featureCode: row.featureCodeSnapshot, featureName: row.featureNameSnapshot ?? row.featureCodeSnapshot,
    usedQuantity: decimal(row.usedQuantity).toString(), includedQuantity: decimal(row.includedQuantity).toString(),
    billableQuantity: decimal(row.billableQuantity).toString(), unitRate: money(row.currency, decimal(row.unitRate)), ratedAmount: money(row.currency, decimal(row.amount)),
    usageEventCount: row.usageEventCount, ratedUsageCount: 1,
  };
}

function toPeriodSummary(period: Period, asOf: Date): MerchantBillingPeriodSummary {
  if (period.subscription.shopId !== period.shopId) throw new BillingSummaryInvariantError("Billing period subscription shop does not match billing period shop.");
  const subscription = toSubscriptionSummary(period.subscription);
  // MerchantRatedUsage is unique by billingPeriodId + billableFeatureId, so each row is an immutable feature-period total.
  const features = period.ratedUsages.map((row) => {
    if (row.shopId !== period.shopId || row.billingPeriodId !== period.id) throw new BillingSummaryInvariantError("Rated usage does not belong to the requested billing period and shop.");
    return toFeature(row, subscription.currency);
  }).sort((left, right) => left.featureCode.localeCompare(right.featureCode));
  const usage = features.reduce((total, feature) => total.plus(feature.ratedAmount.amount), new Prisma.Decimal(0));
  const base = decimal(subscription.monthlyBasePrice);
  return {
    billingPeriodId: period.id, status: period.status, periodStart: period.periodStart.toISOString(), periodEnd: period.periodEnd.toISOString(), subscription, features,
    // The schema does not yet snapshot base-plan price on periods; this uses the subscription's attached plan.
    baseSubscriptionAmount: money(subscription.currency, base), usageChargeAmount: money(subscription.currency, usage), estimatedTotalAmount: money(subscription.currency, base.plus(usage)),
    totalUsageEventCount: features.reduce((total, feature) => total + feature.usageEventCount, 0), totalRatedUsageCount: features.reduce((total, feature) => total + feature.ratedUsageCount, 0),
    isCurrentPeriod: period.periodStart <= asOf && asOf < period.periodEnd,
  };
}

const periodInclude = { subscription: { include: { pricingPlan: true } }, ratedUsages: { orderBy: { featureCodeSnapshot: "asc" } } };

export async function getCurrentMerchantSubscriptionSummary(input: { shopId: string; asOf?: Date }): Promise<MerchantSubscriptionSummary | null> {
  const asOf = input.asOf ?? new Date();
  const subscription = await prismaClient.merchantSubscription.findFirst({ where: { shopId: input.shopId }, include: { pricingPlan: true } });
  return subscription && subscriptionIsActiveAt(subscription, asOf) ? toSubscriptionSummary(subscription) : null;
}

export async function getCurrentBillingPeriodSummary(input: { shopId: string; asOf?: Date }): Promise<MerchantBillingPeriodSummary | null> {
  const asOf = input.asOf ?? new Date();
  const period = await prismaClient.merchantBillingPeriod.findFirst({ where: { shopId: input.shopId, status: { not: "VOID" }, periodStart: { lte: asOf }, periodEnd: { gt: asOf } }, orderBy: { periodStart: "desc" }, include: periodInclude });
  if (!period || !subscriptionIsActiveAt(period.subscription, asOf)) return null;
  return toPeriodSummary(period, asOf);
}

export async function getBillingPeriodSummary(input: { shopId: string; billingPeriodId: string }): Promise<MerchantBillingPeriodSummary | null> {
  const period = await prismaClient.merchantBillingPeriod.findFirst({ where: { id: input.billingPeriodId, shopId: input.shopId }, include: periodInclude });
  return period ? toPeriodSummary(period, new Date()) : null;
}

type Cursor = { periodStart: string; id: string };
function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    if (!parsed || typeof parsed.id !== "string" || Number.isNaN(new Date(parsed.periodStart).getTime())) throw new Error();
    return parsed;
  } catch { throw new BillingSummaryInvariantError("Invalid billing period cursor."); }
}
function encodeCursor(period: Period) { return Buffer.from(JSON.stringify({ periodStart: period.periodStart.toISOString(), id: period.id })).toString("base64url"); }

export async function listBillingPeriodSummaries(input: { shopId: string; limit?: number; cursor?: string; status?: string }): Promise<BillingPeriodSummaryPage> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const cursorStart = cursor ? new Date(cursor.periodStart) : null;
  const where = { shopId: input.shopId, ...(input.status ? { status: input.status } : {}), ...(cursorStart ? { OR: [{ periodStart: { lt: cursorStart } }, { periodStart: cursorStart, id: { lt: cursor!.id } }] } : {}) };
  const periods = await prismaClient.merchantBillingPeriod.findMany({ where, orderBy: [{ periodStart: "desc" }, { id: "desc" }], take: limit + 1, include: periodInclude });
  const page = periods.slice(0, limit);
  return { items: page.map((period) => toPeriodSummary(period, new Date())), nextCursor: periods.length > limit && page.length ? encodeCursor(page[page.length - 1]) : null };
}

export async function getCurrentFeatureUsageSummary(input: { shopId: string; featureCode: string; asOf?: Date }): Promise<BillingFeatureUsageSummary | null> {
  const summary = await getCurrentBillingPeriodSummary(input);
  return summary?.features.find((feature) => feature.featureCode === input.featureCode) ?? null;
}
