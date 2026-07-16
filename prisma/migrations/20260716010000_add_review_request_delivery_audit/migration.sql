ALTER TABLE "ReviewRequest" ADD COLUMN "lastSendAttemptAt" TIMESTAMP(3), ADD COLUMN "lastSendErrorCode" TEXT, ADD COLUMN "providerMessageId" TEXT;
CREATE INDEX "ReviewRequest_status_eligibleAt_id_idx" ON "ReviewRequest"("status", "eligibleAt", "id");
CREATE INDEX "ReviewRequest_shopId_status_eligibleAt_id_idx" ON "ReviewRequest"("shopId", "status", "eligibleAt", "id");
