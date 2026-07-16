import type { MerchantBillingPeriodSummary, MerchantSubscriptionSummary } from "./billing-summary.types.ts";
import type { BillingLifecycleStatus } from "./lifecycle.ts";
import type { MerchantPricingPlanDto } from "./plans/plan-catalog.ts";

export type BillingProviderStatusSummary = {
  provider: string;
  status: string;
  confirmationRequired: boolean;
  confirmationUrl: string | null;
  lastUpdatedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

/** A deliberately small, transport-safe view for the merchant admin dashboard. */
export type MerchantBillingDashboardDto = {
  subscription: MerchantSubscriptionSummary | null;
  currentPeriod: MerchantBillingPeriodSummary | null;
  provider: BillingProviderStatusSummary | null;
  lifecycle: BillingLifecycleStatus | null;
  plans: MerchantPricingPlanDto[];
  planChange: { id: string; status: string; type: string; timing: string; effectiveAt: string | null; fromPlan: string | null; toPlan: string | null } | null;
};
