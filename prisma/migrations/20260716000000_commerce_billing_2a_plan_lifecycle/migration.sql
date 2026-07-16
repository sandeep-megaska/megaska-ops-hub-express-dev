-- Provider-independent plan-change intents. Current billing-period and rated usage snapshots remain immutable.
CREATE TYPE "MerchantPlanChangeType" AS ENUM ('INITIAL_SUBSCRIPTION', 'UPGRADE', 'DOWNGRADE', 'CANCEL', 'REACTIVATE');
CREATE TYPE "MerchantPlanChangeTiming" AS ENUM ('IMMEDIATE', 'PERIOD_END');
CREATE TYPE "MerchantPlanChangeStatus" AS ENUM ('PENDING', 'PENDING_PROVIDER_CONFIRMATION', 'SCHEDULED', 'PROCESSING', 'APPLIED', 'CANCELED', 'FAILED_RETRYABLE', 'FAILED_FINAL');
ALTER TABLE "PricingPlan" ADD COLUMN "tierRank" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "MerchantPlanChange" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "merchantSubscriptionId" TEXT NOT NULL,
  "fromPricingPlanId" TEXT, "toPricingPlanId" TEXT, "changeType" "MerchantPlanChangeType" NOT NULL,
  "timing" "MerchantPlanChangeTiming" NOT NULL, "status" "MerchantPlanChangeStatus" NOT NULL DEFAULT 'PENDING',
  "effectiveAt" TIMESTAMP(3), "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3), "appliedAt" TIMESTAMP(3), "canceledAt" TIMESTAMP(3), "failedAt" TIMESTAMP(3),
  "provider" "BillingProvider", "providerSubmissionId" TEXT, "externalReference" TEXT,
  "idempotencyKey" TEXT NOT NULL, "failureCode" TEXT, "failureMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MerchantPlanChange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MerchantPlanChange_idempotencyKey_key" ON "MerchantPlanChange"("idempotencyKey");
CREATE INDEX "MerchantPlanChange_shopId_merchantSubscriptionId_status_idx" ON "MerchantPlanChange"("shopId", "merchantSubscriptionId", "status");
CREATE INDEX "MerchantPlanChange_status_effectiveAt_id_idx" ON "MerchantPlanChange"("status", "effectiveAt", "id");
ALTER TABLE "MerchantPlanChange" ADD CONSTRAINT "MerchantPlanChange_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantPlanChange" ADD CONSTRAINT "MerchantPlanChange_merchantSubscriptionId_fkey" FOREIGN KEY ("merchantSubscriptionId") REFERENCES "MerchantSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantPlanChange" ADD CONSTRAINT "MerchantPlanChange_fromPricingPlanId_fkey" FOREIGN KEY ("fromPricingPlanId") REFERENCES "PricingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantPlanChange" ADD CONSTRAINT "MerchantPlanChange_toPricingPlanId_fkey" FOREIGN KEY ("toPricingPlanId") REFERENCES "PricingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
