CREATE TYPE "BillingReconciliationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'MATCHED', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'MISSING_PROVIDER_REFERENCE', 'DUPLICATE_PROVIDER_SUBMISSION', 'PROVIDER_NOT_FOUND', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'SKIPPED_ZERO_AMOUNT');

CREATE TABLE "MerchantBillingReconciliation" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "billingPeriodId" TEXT NOT NULL,
  "merchantRatedUsageId" TEXT,
  "provider" "BillingProvider" NOT NULL,
  "status" "BillingReconciliationStatus" NOT NULL,
  "internalAmount" DECIMAL(18,6),
  "internalCurrency" TEXT,
  "providerAmount" DECIMAL(18,6),
  "providerCurrency" TEXT,
  "providerSubmissionId" TEXT,
  "externalReference" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantBillingReconciliation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantBillingReconciliation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MerchantBillingReconciliation_shopId_billingPeriodId_checkedAt_idx" ON "MerchantBillingReconciliation"("shopId", "billingPeriodId", "checkedAt");
CREATE INDEX "MerchantBillingReconciliation_merchantRatedUsageId_checkedAt_idx" ON "MerchantBillingReconciliation"("merchantRatedUsageId", "checkedAt");
