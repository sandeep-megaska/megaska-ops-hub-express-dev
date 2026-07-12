ALTER TABLE "PromotionRuntimeSyncState" ADD COLUMN "synchronizationAttemptId" TEXT;
ALTER TABLE "PromotionRuntimeSyncState" ADD COLUMN "synchronizationLeaseExpiresAt" TIMESTAMP(3);
CREATE INDEX "PromotionRuntimeSyncState_synchronizationAttemptId_idx" ON "PromotionRuntimeSyncState"("synchronizationAttemptId");
CREATE INDEX "PromotionRuntimeSyncState_synchronizationLeaseExpiresAt_idx" ON "PromotionRuntimeSyncState"("synchronizationLeaseExpiresAt");
