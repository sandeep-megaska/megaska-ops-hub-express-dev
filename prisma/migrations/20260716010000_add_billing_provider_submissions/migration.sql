CREATE TYPE "BillingProviderOperation" AS ENUM ('CREATE_SUBSCRIPTION', 'CREATE_USAGE_RECORD');
CREATE TYPE "BillingProviderSubmissionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL');

ALTER TABLE "MerchantSubscription"
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "confirmationUrl" TEXT,
  ADD COLUMN "providerActivatedAt" TIMESTAMP(3),
  ADD COLUMN "providerMetadata" JSONB;

CREATE TABLE "MerchantBillingProviderSubmission" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "merchantSubscriptionId" TEXT NOT NULL,
  "merchantBillingPeriodId" TEXT,
  "merchantRatedUsageId" TEXT,
  "provider" "BillingProvider" NOT NULL,
  "operation" "BillingProviderOperation" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "BillingProviderSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  "externalReference" TEXT,
  "externalParentReference" TEXT,
  "recurringLineItemReference" TEXT,
  "usageLineItemReference" TEXT,
  "amount" DECIMAL(18,6),
  "currency" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "succeededAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "requestSnapshot" JSONB,
  "responseSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MerchantBillingProviderSubmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MerchantBillingProviderSubmission_provider_operation_idempotencyKey_key" ON "MerchantBillingProviderSubmission"("provider", "operation", "idempotencyKey");
CREATE UNIQUE INDEX "MerchantBillingProviderSubmission_provider_operation_merchantRatedUsageId_key" ON "MerchantBillingProviderSubmission"("provider", "operation", "merchantRatedUsageId");
CREATE INDEX "MerchantBillingProviderSubmission_shopId_status_idx" ON "MerchantBillingProviderSubmission"("shopId", "status");
CREATE INDEX "MerchantBillingProviderSubmission_merchantSubscriptionId_operation_idx" ON "MerchantBillingProviderSubmission"("merchantSubscriptionId", "operation");
CREATE INDEX "MerchantBillingProviderSubmission_merchantBillingPeriodId_idx" ON "MerchantBillingProviderSubmission"("merchantBillingPeriodId");
ALTER TABLE "MerchantBillingProviderSubmission" ADD CONSTRAINT "MerchantBillingProviderSubmission_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantBillingProviderSubmission" ADD CONSTRAINT "MerchantBillingProviderSubmission_merchantSubscriptionId_fkey" FOREIGN KEY ("merchantSubscriptionId") REFERENCES "MerchantSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
