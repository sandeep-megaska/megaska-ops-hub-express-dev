import { Prisma } from "../../generated/prisma/index.js";
import { prisma as defaultPrisma } from "../db/prisma.ts";
import { calculateFeatureRating } from "./rating-core.ts";
import { usageTypeToFeatureCode } from "./rating.ts";

const PLATFORM_BILLABLE_PROVIDERS = ["PLATFORM_TWILIO", "PLATFORM_RESEND", "PLATFORM_MSG91"];
const ACTIVE_SUBSCRIPTION_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE"];

type PlanFeature = { id: string; active: boolean; includedQuantity: unknown; overageUnitPrice: unknown; billableFeature: { id: string; code: string; name: string; active: boolean } };
type Subscription = { id: string; shopId: string; status: string; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; canceledAt: Date | null; cancellationEffectiveAt: Date | null; pricingPlan: { id: string; code: string; name: string; currency: string; monthlyBasePrice: unknown; active: boolean; features: PlanFeature[] } };
type Period = { id: string; shopId: string; subscriptionId: string; periodStart: Date; periodEnd: Date; status: string; subscription: Subscription };
type Aggregate = { usageType: keyof typeof usageTypeToFeatureCode; _sum: { quantity: unknown | null }; _count: { _all: number } };
type EstimateDb = {
  merchantSubscription: { findMany(args: unknown): Promise<Subscription[]> };
  merchantBillingPeriod: { findFirst(args: unknown): Promise<Period | null> };
  merchantUsageEvent: { groupBy(args: unknown): Promise<Aggregate[]> };
};

let prismaClient: EstimateDb = defaultPrisma as unknown as EstimateDb;
export function __setLiveUsageEstimatePrismaForTests(client: EstimateDb) { prismaClient = client; }

export class LiveUsageEstimateCurrencyError extends Error {
  code = "BILLING_CURRENCY_MISMATCH";
  constructor(message: string) { super(message); this.name = "LiveUsageEstimateCurrencyError"; }
}

export type MerchantLiveUsageEstimate = {
  shopId: string; subscriptionId: string; planId: string; planCode: string; planName: string;
  billingPeriodId: string; billingPeriodStart: string; billingPeriodEnd: string; billingPeriodStatus: string; currency: string;
  baseSubscriptionAmount: { amount: string; currency: string };
  features: Array<{ featureId: string; featureCode: string; featureName: string; usageQuantity: string; includedQuantity: string; billableQuantity: string; unitRate: { amount: string; currency: string }; estimatedCharge: { amount: string; currency: string }; usageEventCount: number; source: "LIVE_ESTIMATE" }>;
  estimatedUsageChargeAmount: { amount: string; currency: string }; estimatedTotalAmount: { amount: string; currency: string };
  generatedAt: string; isFinal: false;
};

function decimal(value: unknown) { return new Prisma.Decimal((value ?? 0) as Prisma.Decimal.Value); }
function activeAt(subscription: Subscription, asOf: Date) {
  if (!ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)) return false;
  if (subscription.currentPeriodStart && subscription.currentPeriodStart > asOf) return false;
  if (subscription.currentPeriodEnd && subscription.currentPeriodEnd <= asOf) return false;
  const end = subscription.cancellationEffectiveAt ?? subscription.canceledAt;
  return !end || end > asOf;
}

/** Read-only current-period commercial preview; it never creates periods or rated usage. */
export async function getCurrentLiveUsageEstimate(input: { shopId: string; asOf?: Date }): Promise<MerchantLiveUsageEstimate | null> {
  const startedAt = Date.now(); const asOf = input.asOf ?? new Date();
  try {
    console.info("live_usage_estimate_started", { shopId: input.shopId });
    const subscriptions = await prismaClient.merchantSubscription.findMany({
      where: { shopId: input.shopId, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } }, orderBy: [{ currentPeriodStart: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      include: { pricingPlan: { include: { features: { include: { billableFeature: true } } } } },
    });
    const subscription = subscriptions.find((candidate) => activeAt(candidate, asOf));
    if (!subscription) return null;
    const period = await prismaClient.merchantBillingPeriod.findFirst({
      where: { shopId: input.shopId, subscriptionId: subscription.id, status: "OPEN", periodStart: { lte: asOf }, periodEnd: { gt: asOf } }, orderBy: { periodStart: "desc" },
      include: { subscription: { include: { pricingPlan: { include: { features: { include: { billableFeature: true } } } } } } },
    });
    if (!period || period.subscription.shopId !== input.shopId) return null;
    const plan = period.subscription.pricingPlan;
    if (!plan.active) throw new Error("PRICING_PLAN_INACTIVE");
    const aggregates = await prismaClient.merchantUsageEvent.groupBy({
      by: ["usageType"], where: { shopId: input.shopId, status: "RECORDED", provider: { in: PLATFORM_BILLABLE_PROVIDERS }, occurredAt: { gte: period.periodStart, lt: period.periodEnd } }, _sum: { quantity: true }, _count: { _all: true },
    });
    const usage = new Map<string, { quantity: Prisma.Decimal; count: number }>();
    for (const item of aggregates) { const featureCode = usageTypeToFeatureCode[item.usageType]; if (featureCode) usage.set(featureCode, { quantity: decimal(item._sum.quantity), count: item._count._all }); }
    const activeFeatures = plan.features.filter((feature) => feature.active && feature.billableFeature.active);
    for (const featureCode of usage.keys()) if (!activeFeatures.some((feature) => feature.billableFeature.code === featureCode)) throw new Error("FEATURE_PRICING_MISSING");
    const features = activeFeatures.map((feature) => {
      const aggregate = usage.get(feature.billableFeature.code) ?? { quantity: new Prisma.Decimal(0), count: 0 };
      const rated = calculateFeatureRating({ usedQuantity: aggregate.quantity, includedQuantity: decimal(feature.includedQuantity), unitRate: decimal(feature.overageUnitPrice) });
      return { featureId: feature.billableFeature.id, featureCode: feature.billableFeature.code, featureName: feature.billableFeature.name, usageQuantity: rated.usedQuantity.toString(), includedQuantity: rated.includedQuantity.toString(), billableQuantity: rated.billableQuantity.toString(), unitRate: { amount: decimal(feature.overageUnitPrice).toString(), currency: plan.currency }, estimatedCharge: { amount: rated.amount.toString(), currency: plan.currency }, usageEventCount: aggregate.count, source: "LIVE_ESTIMATE" as const };
    }).sort((a, b) => a.featureCode.localeCompare(b.featureCode));
    const usageAmount = features.reduce((sum, feature) => sum.plus(feature.estimatedCharge.amount), new Prisma.Decimal(0)); const base = decimal(plan.monthlyBasePrice);
    const estimate: MerchantLiveUsageEstimate = { shopId: input.shopId, subscriptionId: subscription.id, planId: plan.id, planCode: plan.code, planName: plan.name, billingPeriodId: period.id, billingPeriodStart: period.periodStart.toISOString(), billingPeriodEnd: period.periodEnd.toISOString(), billingPeriodStatus: period.status, currency: plan.currency, baseSubscriptionAmount: { amount: base.toString(), currency: plan.currency }, features, estimatedUsageChargeAmount: { amount: usageAmount.toString(), currency: plan.currency }, estimatedTotalAmount: { amount: base.plus(usageAmount).toString(), currency: plan.currency }, generatedAt: new Date().toISOString(), isFinal: false };
    console.info("live_usage_estimate_completed", { shopId: input.shopId, subscriptionId: subscription.id, billingPeriodId: period.id, planCode: plan.code, featureCount: features.length, usageEventCount: features.reduce((sum, feature) => sum + feature.usageEventCount, 0), estimatedUsageCharge: estimate.estimatedUsageChargeAmount.amount, currency: plan.currency, duration: Date.now() - startedAt });
    return estimate;
  } catch (error) {
    const code = error instanceof LiveUsageEstimateCurrencyError ? error.code : error instanceof Error ? error.message : "LIVE_USAGE_ESTIMATE_FAILED";
    console.error("live_usage_estimate_failed", { shopId: input.shopId, errorCode: code, duration: Date.now() - startedAt }); throw error;
  }
}
