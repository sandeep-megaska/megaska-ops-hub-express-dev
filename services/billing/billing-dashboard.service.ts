import { prisma as defaultPrisma } from "../db/prisma.ts";
import { getCurrentBillingPeriodSummary, getCurrentMerchantSubscriptionSummary, listBillingPeriodSummaries } from "./billing-summary.ts";
import type { BillingPeriodSummaryPage } from "./billing-summary.types.ts";
import type { BillingProviderStatusSummary, MerchantBillingDashboardDto } from "./billing-dashboard.types.ts";
import { getBillingLifecycleStatus } from "./lifecycle.ts";
import { listAvailablePricingPlans } from "./plans/plan-catalog.ts";
import { getCurrentPlanLifecycleStatus } from "./plans/plan-lifecycle.ts";

type Submission = { status: string; errorCode: string | null; errorMessage: string | null; updatedAt: Date };
type SubscriptionProviderRow = { billingProvider: string; providerStatus: string | null; confirmationUrl: string | null; providerActivatedAt: Date | null; updatedAt: Date; billingProviderSubmissions: Submission[] };
type DashboardDb = { merchantSubscription: { findFirst(args: unknown): Promise<SubscriptionProviderRow | null> } };
let prismaClient: DashboardDb = defaultPrisma as unknown as DashboardDb;

/** Test-only dependency injection; all production reads remain tenant-scoped. */
export function __setBillingDashboardPrismaForTests(client: DashboardDb) { prismaClient = client; }

function merchantSafeProviderError(code: string | null, message: string | null) {
  if (!code && !message) return null;
  if (code === "SHOPIFY_USER_ERROR") return "Shopify could not approve this billing request.";
  if (code === "SHOPIFY_TRANSPORT_RETRYABLE") return "Shopify billing is temporarily unavailable.";
  return "Shopify billing needs attention. Please try again later or contact support.";
}

function normalizeProviderStatus(row: SubscriptionProviderRow): BillingProviderStatusSummary {
  const submission = row.billingProviderSubmissions[0] ?? null;
  const status = row.providerStatus ?? (submission?.status === "FAILED_RETRYABLE" ? "RETRYING" : submission?.status ?? "NOT_CONFIGURED");
  const confirmationRequired = status === "PENDING_CONFIRMATION" || Boolean(row.confirmationUrl);
  return {
    provider: row.billingProvider,
    status,
    confirmationRequired,
    confirmationUrl: confirmationRequired ? row.confirmationUrl : null,
    lastUpdatedAt: (row.providerActivatedAt ?? submission?.updatedAt ?? row.updatedAt).toISOString(),
    errorCode: submission?.errorCode ?? null,
    errorMessage: merchantSafeProviderError(submission?.errorCode ?? null, submission?.errorMessage ?? null),
  };
}

export async function getBillingProviderStatus(input: { shopId: string }): Promise<BillingProviderStatusSummary | null> {
  const row = await prismaClient.merchantSubscription.findFirst({
    where: { shopId: input.shopId },
    select: {
      billingProvider: true, providerStatus: true, confirmationUrl: true, providerActivatedAt: true, updatedAt: true,
      billingProviderSubmissions: { orderBy: { updatedAt: "desc" }, take: 1, select: { status: true, errorCode: true, errorMessage: true, updatedAt: true } },
    },
  });
  return row ? normalizeProviderStatus(row) : null;
}

export async function getMerchantBillingDashboard(input: { shopId: string }): Promise<MerchantBillingDashboardDto> {
  const [subscription, currentPeriod, provider, lifecycle, plans, planChange] = await Promise.all([
    getCurrentMerchantSubscriptionSummary({ shopId: input.shopId }),
    getCurrentBillingPeriodSummary({ shopId: input.shopId }),
    getBillingProviderStatus({ shopId: input.shopId }),
    getBillingLifecycleStatus({ shopId: input.shopId }),
    listAvailablePricingPlans({ shopId: input.shopId }),
    getCurrentPlanLifecycleStatus({ shopId: input.shopId }),
  ]);
  return { subscription, currentPeriod, provider, lifecycle, plans, planChange: planChange ? { id: planChange.id, status: planChange.status, type: planChange.changeType, timing: planChange.timing, effectiveAt: planChange.effectiveAt?.toISOString() ?? null, fromPlan: planChange.fromPricingPlan?.name ?? null, toPlan: planChange.toPricingPlan?.name ?? null } : null };
}

export async function getMerchantBillingHistory(input: { shopId: string; cursor?: string; limit?: number }): Promise<BillingPeriodSummaryPage> {
  return listBillingPeriodSummaries({ shopId: input.shopId, cursor: input.cursor, limit: input.limit });
}
