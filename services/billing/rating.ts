import { Prisma } from "../../generated/prisma/index.js";
import { prisma as defaultPrisma } from "../db/prisma.ts";
import { calculateFeatureRating } from "./rating-core.ts";

const LOG_PREFIX = "[COMMERCIAL RATING]";

/** Deliberately explicit: commercial feature codes are not inferred from ledger enum names. */
export const usageTypeToFeatureCode = {
  OTP: "OTP", EMAIL: "EMAIL", SMS: "SMS", WHATSAPP: "WHATSAPP", AI: "AI",
  DELIVERY_LOOKUP: "DELIVERY_LOOKUP", CHECKOUT_TRANSACTION: "CHECKOUT",
} as const;

type Status = "OPEN" | "RATING" | "RATED" | "CLOSED" | "VOID";
type PlanFeature = { id: string; active: boolean; includedQuantity: unknown; overageUnitPrice: unknown; billableFeature: { id: string; code: string; name: string; active: boolean } };
type Period = { id: string; shopId: string; subscriptionId: string; periodStart: Date; periodEnd: Date; status: Status; ratedAt: Date | null; subscription?: { shopId: string; pricingPlan: { id: string; code: string; name: string; currency: string; active: boolean; features: PlanFeature[] } } };
type RatedRow = { billingPeriodId: string; shopId: string; planCodeSnapshot: string; currency: string; ratedAt: Date; featureCodeSnapshot: string; usedQuantity: unknown; includedQuantity: unknown; billableQuantity: unknown; unitRate: unknown; amount: unknown; usageEventCount: number };
type RatingDb = {
  shop: { findUnique(args: unknown): Promise<{ id: string } | null> };
  merchantBillingPeriod: { findUnique(args: unknown): Promise<Period | null>; updateMany(args: unknown): Promise<{ count: number }>; update(args: unknown): Promise<Period> };
  merchantUsageEvent: { findMany(args: unknown): Promise<Array<{ usageType: keyof typeof usageTypeToFeatureCode; quantity: unknown }>> };
  merchantRatedUsage: { createMany(args: unknown): Promise<unknown>; findMany(args: unknown): Promise<RatedRow[]> };
};
let prismaClient = defaultPrisma as unknown as RatingDb & { $transaction<T>(fn: (tx: RatingDb) => Promise<T>): Promise<T> };
export function __setCommercialRatingPrismaForTests(client: typeof prismaClient) { prismaClient = client; }

export class CommercialRatingError extends Error { constructor(message: string) { super(message); this.name = "CommercialRatingError"; } }
export type RateBillingPeriodResult = { billingPeriodId: string; shopId: string; pricingPlanCode: string; currency: string; ratedAt: Date; created: boolean; features: Array<{ featureCode: string; usedQuantity: string; includedQuantity: string; billableQuantity: string; unitRate: string; amount: string; usageEventCount: number }>; totals: { usageAmount: string } };
function log(operation: string, fields: Record<string, unknown>) { console.info(LOG_PREFIX, operation, fields); }
function decimal(value: unknown) { return new Prisma.Decimal((value ?? 0) as Prisma.Decimal.Value); }
function result(rows: RatedRow[], created: boolean): RateBillingPeriodResult | null {
  if (!rows.length) return null;
  const features = rows.map((row) => ({ featureCode: row.featureCodeSnapshot, usedQuantity: decimal(row.usedQuantity).toString(), includedQuantity: decimal(row.includedQuantity).toString(), billableQuantity: decimal(row.billableQuantity).toString(), unitRate: decimal(row.unitRate).toString(), amount: decimal(row.amount).toString(), usageEventCount: row.usageEventCount }));
  return { billingPeriodId: rows[0].billingPeriodId, shopId: rows[0].shopId, pricingPlanCode: rows[0].planCodeSnapshot, currency: rows[0].currency, ratedAt: rows[0].ratedAt, created, features, totals: { usageAmount: features.reduce((total, feature) => total.plus(feature.amount), new Prisma.Decimal(0)).toString() } };
}
async function existing(db: RatingDb, shopId: string, billingPeriodId: string, created: boolean) {
  const rows = await db.merchantRatedUsage.findMany({ where: { shopId, billingPeriodId }, orderBy: { featureCodeSnapshot: "asc" } });
  return result(rows, created);
}
export async function getRatedBillingPeriod(shopId: string, billingPeriodId: string): Promise<RateBillingPeriodResult | null> {
  const period = await prismaClient.merchantBillingPeriod.findUnique({ where: { id: billingPeriodId }, select: { shopId: true } });
  if (!period || period.shopId !== shopId) return null;
  return existing(prismaClient, shopId, billingPeriodId, false);
}

export async function rateBillingPeriod(shopId: string, billingPeriodId: string): Promise<RateBillingPeriodResult> {
  try {
    const output = await prismaClient.$transaction(async (db) => {
      const shop = await db.shop.findUnique({ where: { id: shopId }, select: { id: true } });
      if (!shop) throw new CommercialRatingError("SHOP_NOT_FOUND");
      const period = await db.merchantBillingPeriod.findUnique({ where: { id: billingPeriodId }, include: { subscription: { include: { pricingPlan: { include: { features: { include: { billableFeature: true } } } } } } } });
      if (!period || period.shopId !== shopId) { log("ownership_rejected", { shopId, billingPeriodId }); throw new CommercialRatingError("BILLING_PERIOD_NOT_FOUND"); }
      if (period.status === "RATED") { const rated = await existing(db, shopId, billingPeriodId, false); if (!rated) throw new CommercialRatingError("RATED_USAGE_MISSING"); log("rating_existing_returned", { shopId, billingPeriodId }); return rated; }
      if (period.status === "RATING") { log("rating_in_progress", { shopId, billingPeriodId }); throw new CommercialRatingError("RATING_IN_PROGRESS"); }
      if (period.status === "VOID" || period.status === "CLOSED") throw new CommercialRatingError("BILLING_PERIOD_NOT_RATEABLE");
      if (period.status !== "OPEN") throw new CommercialRatingError("BILLING_PERIOD_NOT_RATEABLE");
      if (!period.subscription || period.subscription.shopId !== shopId) throw new CommercialRatingError("SUBSCRIPTION_SHOP_MISMATCH");
      const plan = period.subscription.pricingPlan;
      if (!plan) { log("plan_missing", { shopId, billingPeriodId, subscriptionId: period.subscriptionId }); throw new CommercialRatingError("PRICING_PLAN_MISSING"); }
      if (!plan.active) { log("plan_inactive", { shopId, billingPeriodId, subscriptionId: period.subscriptionId, pricingPlanCode: plan.code }); throw new CommercialRatingError("PRICING_PLAN_INACTIVE"); }
      const claimed = await db.merchantBillingPeriod.updateMany({ where: { id: billingPeriodId, shopId, status: "OPEN" }, data: { status: "RATING" } });
      if (claimed.count !== 1) throw new CommercialRatingError("RATING_IN_PROGRESS");
      log("rating_started", { shopId, billingPeriodId, subscriptionId: period.subscriptionId, pricingPlanCode: plan.code });
      const events = await db.merchantUsageEvent.findMany({ where: { shopId, status: "RECORDED", provider: { in: ["PLATFORM_TWILIO", "PLATFORM_RESEND", "PLATFORM_MSG91"] }, occurredAt: { gte: period.periodStart, lt: period.periodEnd } }, select: { usageType: true, quantity: true } });
      const usage = new Map<string, { quantity: Prisma.Decimal; count: number }>();
      for (const event of events) { const code = usageTypeToFeatureCode[event.usageType]; if (code) { const current = usage.get(code) ?? { quantity: new Prisma.Decimal(0), count: 0 }; current.quantity = current.quantity.plus(decimal(event.quantity)); current.count++; usage.set(code, current); } }
      const activeFeatures = plan.features.filter((feature) => feature.active);
      const priced = new Map(activeFeatures.map((feature) => [feature.billableFeature.code, feature]));
      for (const [code] of usage) { const feature = priced.get(code); if (!feature) { log("feature_pricing_missing", { shopId, billingPeriodId, pricingPlanCode: plan.code }); throw new CommercialRatingError("FEATURE_PRICING_MISSING"); } if (!feature.billableFeature.active) throw new CommercialRatingError("BILLABLE_FEATURE_INACTIVE"); }
      const ratedAt = new Date();
      const rows = activeFeatures.map((feature) => {
        const aggregate = usage.get(feature.billableFeature.code) ?? { quantity: new Prisma.Decimal(0), count: 0 };
        const calculation = calculateFeatureRating({ usedQuantity: aggregate.quantity, includedQuantity: decimal(feature.includedQuantity), unitRate: decimal(feature.overageUnitPrice) });
        return { shopId, billingPeriodId, pricingPlanId: plan.id, billableFeatureId: feature.billableFeature.id, featureCodeSnapshot: feature.billableFeature.code, featureNameSnapshot: feature.billableFeature.name, planCodeSnapshot: plan.code, planNameSnapshot: plan.name, currency: plan.currency, usedQuantity: calculation.usedQuantity, includedQuantity: calculation.includedQuantity, billableQuantity: calculation.billableQuantity, unitRate: decimal(feature.overageUnitPrice), amount: calculation.amount, usageEventCount: aggregate.count, ratedAt };
      });
      await db.merchantRatedUsage.createMany({ data: rows });
      await db.merchantBillingPeriod.update({ where: { id: billingPeriodId }, data: { status: "RATED", ratedAt } });
      const rated = await existing(db, shopId, billingPeriodId, true); if (!rated) throw new CommercialRatingError("RATED_USAGE_MISSING");
      log("rating_completed", { shopId, billingPeriodId, subscriptionId: period.subscriptionId, pricingPlanCode: plan.code, featureCount: rows.length, usageEventCount: events.length, usageAmount: rated.totals.usageAmount });
      return rated;
    });
    return output;
  } catch (error) { log("rating_failed", { shopId, billingPeriodId }); throw error; }
}
