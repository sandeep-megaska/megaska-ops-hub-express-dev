/** JSON-safe, provider-independent commercial money value. */
export type BillingMoney = {
  currency: string;
  amount: string;
};

export type BillingFeatureUsageSummary = {
  featureId: string;
  featureCode: string;
  featureName: string;
  usedQuantity: string;
  includedQuantity: string;
  billableQuantity: string;
  unitRate: BillingMoney;
  ratedAmount: BillingMoney;
  usageEventCount: number;
  ratedUsageCount: number;
};

export type MerchantSubscriptionSummary = {
  subscriptionId: string;
  status: string;
  provider: string | null;
  planId: string;
  planCode: string;
  planName: string;
  currency: string;
  monthlyBasePrice: string;
  startedAt: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
};

export type MerchantBillingPeriodSummary = {
  billingPeriodId: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  subscription: MerchantSubscriptionSummary;
  features: BillingFeatureUsageSummary[];
  baseSubscriptionAmount: BillingMoney;
  usageChargeAmount: BillingMoney;
  estimatedTotalAmount: BillingMoney;
  totalUsageEventCount: number;
  totalRatedUsageCount: number;
  isCurrentPeriod: boolean;
};

export type BillingPeriodSummaryPage = {
  items: MerchantBillingPeriodSummary[];
  nextCursor: string | null;
};
