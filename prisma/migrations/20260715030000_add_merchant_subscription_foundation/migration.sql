CREATE TYPE "MerchantSubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED', 'EXPIRED');

CREATE TYPE "BillingProvider" AS ENUM ('SHOPIFY', 'STRIPE', 'RAZORPAY', 'MANUAL', 'INTERNAL');

CREATE TABLE "MerchantSubscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "pricingPlanId" TEXT NOT NULL,
    "status" "MerchantSubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billingProvider" "BillingProvider" NOT NULL DEFAULT 'INTERNAL',
    "externalSubscriptionReference" TEXT,
    "externalCustomerReference" TEXT,
    "trialStartsAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "renewsAutomatically" BOOLEAN NOT NULL DEFAULT true,
    "canceledAt" TIMESTAMP(3),
    "cancellationEffectiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantSubscription_shopId_key" ON "MerchantSubscription"("shopId");
CREATE INDEX "MerchantSubscription_pricingPlanId_idx" ON "MerchantSubscription"("pricingPlanId");
CREATE INDEX "MerchantSubscription_status_idx" ON "MerchantSubscription"("status");
CREATE INDEX "MerchantSubscription_billingProvider_idx" ON "MerchantSubscription"("billingProvider");
CREATE INDEX "MerchantSubscription_currentPeriodEnd_idx" ON "MerchantSubscription"("currentPeriodEnd");

ALTER TABLE "MerchantSubscription" ADD CONSTRAINT "MerchantSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantSubscription" ADD CONSTRAINT "MerchantSubscription_pricingPlanId_fkey" FOREIGN KEY ("pricingPlanId") REFERENCES "PricingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
