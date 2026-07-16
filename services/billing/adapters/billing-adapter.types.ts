/** Provider-neutral contract. Amounts are decimal strings, never JS numbers. */
export type BillingProviderCode = "SHOPIFY" | "STRIPE" | "RAZORPAY" | "MANUAL" | "INTERNAL";

export type CreateProviderSubscriptionInput = {
  shopId: string;
  merchantSubscriptionId: string;
  planName: string;
  returnUrl: string;
  currency: string;
  monthlyBasePrice: string;
  cappedUsageAmount?: string;
  trialDays?: number;
  test?: boolean;
  idempotencyKey: string;
};

export type CreateProviderSubscriptionResult = {
  provider: "SHOPIFY";
  externalSubscriptionId: string | null;
  confirmationUrl: string;
  status: "PENDING_CONFIRMATION";
  recurringLineItemId: string | null;
  usageLineItemId: string | null;
  providerPayload?: { status: string | null };
};

export type CreateProviderUsageChargeInput = {
  shopId: string;
  merchantSubscriptionId: string;
  merchantBillingPeriodId: string;
  merchantRatedUsageId?: string;
  description: string;
  currency: string;
  amount: string;
  /** The persisted Shopify usage line-item GID. */
  usageLineItemId: string;
  idempotencyKey: string;
};

export type CreateProviderUsageChargeResult = {
  provider: "SHOPIFY";
  status: "SUCCEEDED" | "SKIPPED_ZERO_AMOUNT";
  externalUsageRecordId: string | null;
  providerPayload?: { id: string | null };
};

export interface BillingProviderAdapter {
  createSubscription(input: CreateProviderSubscriptionInput): Promise<CreateProviderSubscriptionResult>;
  createUsageCharge(input: CreateProviderUsageChargeInput): Promise<CreateProviderUsageChargeResult>;
}
