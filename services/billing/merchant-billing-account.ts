import { prisma as defaultPrisma } from "../db/prisma.ts";

const DEFAULT_PRIMARY_PLAN_CODE = "PROFESSIONAL";
const INTERNAL_BILLING_ENABLED = process.env.LOOPDESK_INTERNAL_BILLING_ENABLED === "true";

type PlanFeature = { id: string; active: boolean; includedQuantity: unknown; overageUnitPrice: unknown; billableFeature: { id: string; code: string; name: string; active: boolean } };
type Plan = { id: string; code: string; name: string; currency: string; monthlyBasePrice: unknown; active: boolean; features: PlanFeature[] };
type Subscription = { id: string; shopId: string; status: string; billingProvider: string; providerStatus: string | null; confirmationUrl: string | null; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; pricingPlan: Plan };
type Period = { id: string; shopId: string; subscriptionId: string; periodStart: Date; periodEnd: Date; status: string };
type BillingAccountDb = {
  shop: { findUnique(args: unknown): Promise<{ id: string; installationStatus: string } | null> };
  pricingPlan: { findUnique(args: unknown): Promise<Plan | null> };
  merchantSubscription: { findUnique(args: unknown): Promise<Subscription | null>; upsert(args: unknown): Promise<Subscription>; update(args: unknown): Promise<Subscription> };
  merchantBillingPeriod: { findFirst(args: unknown): Promise<Period | null>; create(args: unknown): Promise<Period> };
};
let prismaClient: BillingAccountDb = defaultPrisma as unknown as BillingAccountDb;
export function __setMerchantBillingAccountPrismaForTests(client: BillingAccountDb) { prismaClient = client; }

export class MerchantBillingAccountConfigurationError extends Error {}
export class MerchantBillingAccountNotFoundError extends Error {}

function nextCalendarMonth(date: Date) {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
function isDevelopmentStore(status: string) { return ["DEV", "DEVELOPMENT", "TEST"].includes(status.toUpperCase()); }
function isUniqueConstraint(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002"; }

/** Creates only missing merchant account and cycle records. Estimates remain read-only. */
export async function ensureMerchantBillingAccount(input: { shopId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const shop = await prismaClient.shop.findUnique({ where: { id: input.shopId }, select: { id: true, installationStatus: true } });
  if (!shop) throw new MerchantBillingAccountNotFoundError("Shop was not found.");
  const planCode = process.env.LOOPDESK_PRIMARY_PLAN_CODE || DEFAULT_PRIMARY_PLAN_CODE;
  const plan = await prismaClient.pricingPlan.findUnique({ where: { code: planCode }, include: { features: { include: { billableFeature: true } } } });
  if (!plan?.active) throw new MerchantBillingAccountConfigurationError("The primary LoopDesk plan is not configured.");

  const internal = INTERNAL_BILLING_ENABLED && isDevelopmentStore(shop.installationStatus);
  const start = now;
  const end = nextCalendarMonth(start);
  let subscription = await prismaClient.merchantSubscription.findUnique({ where: { shopId: shop.id }, include: { pricingPlan: { include: { features: { include: { billableFeature: true } } } } } });
  if (!subscription) {
    subscription = await prismaClient.merchantSubscription.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id, pricingPlanId: plan.id, status: internal ? "ACTIVE" : "TRIALING", billingProvider: internal ? "INTERNAL" : "SHOPIFY", providerStatus: internal ? "ACTIVE" : "PENDING_CONFIRMATION", currentPeriodStart: start, currentPeriodEnd: end, renewsAutomatically: true },
      update: {}, include: { pricingPlan: { include: { features: { include: { billableFeature: true } } } } },
    });
  }
  // Only fill absent dates; provider-confirmed Shopify dates are never overwritten.
  if (!subscription.currentPeriodStart || !subscription.currentPeriodEnd) {
    subscription = await prismaClient.merchantSubscription.update({ where: { id: subscription.id }, data: { currentPeriodStart: subscription.currentPeriodStart ?? start, currentPeriodEnd: subscription.currentPeriodEnd ?? end }, include: { pricingPlan: { include: { features: { include: { billableFeature: true } } } } } });
  }
  const periodStart = subscription.currentPeriodStart!;
  const periodEnd = subscription.currentPeriodEnd!;
  let period = await prismaClient.merchantBillingPeriod.findFirst({ where: { shopId: shop.id, subscriptionId: subscription.id, status: { not: "VOID" }, periodStart, periodEnd } });
  if (!period) {
    try { period = await prismaClient.merchantBillingPeriod.create({ data: { shopId: shop.id, subscriptionId: subscription.id, periodStart, periodEnd, status: "OPEN" } }); }
    catch (error) { if (!isUniqueConstraint(error)) throw error; period = await prismaClient.merchantBillingPeriod.findFirst({ where: { shopId: shop.id, subscriptionId: subscription.id, periodStart, periodEnd } }); if (!period) throw error; }
  }
  return { shop, subscription, period };
}
