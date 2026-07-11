CREATE TYPE "PromotionRuntimeSyncStateValue" AS ENUM ('NEVER_SYNCED', 'SYNCING', 'SYNCED', 'FAILED');

CREATE TABLE "PromotionRuntimeSyncState" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "shopifyAutomaticDiscountId" TEXT,
  "lastDeployedConfigurationVersion" INTEGER,
  "lastDeployedConfigurationHash" TEXT,
  "lastRulesFingerprint" TEXT,
  "lastDeployedRuleCount" INTEGER NOT NULL DEFAULT 0,
  "lastSuccessfulSyncAt" TIMESTAMP(3),
  "synchronizationState" "PromotionRuntimeSyncStateValue" NOT NULL DEFAULT 'NEVER_SYNCED',
  "lastAttemptedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "lastVerifiedConfiguration" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionRuntimeSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromotionRuntimeSyncState_shopId_key" ON "PromotionRuntimeSyncState"("shopId");
CREATE INDEX "PromotionRuntimeSyncState_synchronizationState_lastAttemptedAt_idx" ON "PromotionRuntimeSyncState"("synchronizationState", "lastAttemptedAt");
CREATE INDEX "PromotionRuntimeSyncState_shopifyAutomaticDiscountId_idx" ON "PromotionRuntimeSyncState"("shopifyAutomaticDiscountId");
ALTER TABLE "PromotionRuntimeSyncState" ADD CONSTRAINT "PromotionRuntimeSyncState_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
