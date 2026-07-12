CREATE TABLE "PromotionRuntimeSyncState" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "shopifyAutomaticDiscountId" TEXT,
  "lastSuccessfulConfigurationVersion" INTEGER,
  "lastSuccessfulConfigurationHash" TEXT,
  "lastSuccessfulCompilationVersions" JSONB,
  "lastSuccessfulRuleIds" JSONB,
  "activeAttemptId" TEXT,
  "attemptStartedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "stateVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionRuntimeSyncState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromotionRuntimeSyncState_shopId_key" ON "PromotionRuntimeSyncState"("shopId");
CREATE INDEX "PromotionRuntimeSyncState_activeAttemptId_idx" ON "PromotionRuntimeSyncState"("activeAttemptId");
ALTER TABLE "PromotionRuntimeSyncState" ADD CONSTRAINT "PromotionRuntimeSyncState_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
