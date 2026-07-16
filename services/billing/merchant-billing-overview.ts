import { Prisma } from "../../generated/prisma/index.js";
import { ensureMerchantBillingAccount } from "./merchant-billing-account.ts";
import { getCurrentLiveUsageEstimate } from "./live-usage-estimate.ts";
import { listBillingPeriodSummaries } from "./billing-summary.ts";

export type MerchantBillingOverviewDto = { subscription: { status: string; provider: string; planName: string; monthlyBasePrice: { amount: string; currency: string }; periodStart: string; periodEnd: string; nextRenewalAt: string; confirmationRequired: boolean; confirmationUrl: string | null }; usage: Array<{ featureCode: string; featureName: string; usedQuantity: string; includedQuantity: string; billableQuantity: string; unitRate: { amount: string; currency: string }; estimatedCharge: { amount: string; currency: string } }>; totals: { subscriptionAmount: { amount: string; currency: string }; usageAmount: { amount: string; currency: string }; estimatedTotal: { amount: string; currency: string } }; generatedAt: string; history: Array<{ periodStart: string; periodEnd: string; subscriptionAmount: { amount: string; currency: string }; usageAmount: { amount: string; currency: string }; totalAmount: { amount: string; currency: string }; status: string }> };
const friendlyNames: Record<string, string> = { OTP: "OTP requests", EMAIL: "Email sends", SMS: "SMS messages", WHATSAPP: "WhatsApp messages" };
const decimal = (value: unknown) => new Prisma.Decimal((value ?? 0) as Prisma.Decimal.Value).toString();

export async function getMerchantBillingOverview(input: { shopId: string; now?: Date }): Promise<MerchantBillingOverviewDto> {
  const now = input.now ?? new Date();
  const account = await ensureMerchantBillingAccount({ shopId: input.shopId, now });
  const { subscription, period } = account;
  const currency = subscription.pricingPlan.currency;
  const base = { amount: decimal(subscription.pricingPlan.monthlyBasePrice), currency };
  const estimate = await getCurrentLiveUsageEstimate({ shopId: input.shopId, asOf: now });
  const usage = estimate?.features ?? subscription.pricingPlan.features.filter((feature) => feature.active && feature.billableFeature.active).map((feature) => ({ featureCode: feature.billableFeature.code, featureName: feature.billableFeature.name, usageQuantity: "0", includedQuantity: decimal(feature.includedQuantity), billableQuantity: "0", unitRate: { amount: decimal(feature.overageUnitPrice), currency }, estimatedCharge: { amount: "0", currency } }));
  const historyPage = await listBillingPeriodSummaries({ shopId: input.shopId, limit: 6 });
  const history = historyPage.items.filter((item) => item.billingPeriodId !== period.id).slice(0, 5).map((item) => ({ periodStart: item.periodStart, periodEnd: item.periodEnd, subscriptionAmount: item.baseSubscriptionAmount, usageAmount: item.usageChargeAmount, totalAmount: item.estimatedTotalAmount, status: item.status }));
  const usageAmount = estimate?.estimatedUsageChargeAmount ?? { amount: "0", currency };
  const total = estimate?.estimatedTotalAmount ?? base;
  const providerStatus = subscription.providerStatus ?? subscription.status;
  const confirmationRequired = subscription.billingProvider === "SHOPIFY" && (providerStatus === "PENDING_CONFIRMATION" || Boolean(subscription.confirmationUrl));
  return { subscription: { status: providerStatus === "PENDING_CONFIRMATION" ? "PENDING_CONFIRMATION" : subscription.status, provider: subscription.billingProvider, planName: subscription.pricingPlan.name, monthlyBasePrice: base, periodStart: subscription.currentPeriodStart!.toISOString(), periodEnd: subscription.currentPeriodEnd!.toISOString(), nextRenewalAt: subscription.currentPeriodEnd!.toISOString(), confirmationRequired, confirmationUrl: confirmationRequired ? subscription.confirmationUrl : null }, usage: usage.map((feature) => ({ featureCode: feature.featureCode, featureName: friendlyNames[feature.featureCode] ?? feature.featureName, usedQuantity: feature.usageQuantity, includedQuantity: feature.includedQuantity, billableQuantity: feature.billableQuantity, unitRate: feature.unitRate, estimatedCharge: feature.estimatedCharge })), totals: { subscriptionAmount: base, usageAmount, estimatedTotal: total }, generatedAt: estimate?.generatedAt ?? now.toISOString(), history };
}
