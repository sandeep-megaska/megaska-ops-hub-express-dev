import type { MerchantBillingPeriodSummary, MerchantSubscriptionSummary } from "./billing-summary.types.ts";

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
};
