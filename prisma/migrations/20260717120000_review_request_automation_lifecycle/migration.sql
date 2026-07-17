-- REVIEW-1A.13 review request automation lifecycle
CREATE TYPE "ReviewRequestTrigger" AS ENUM ('FULFILLED', 'DELIVERED');
CREATE TYPE "ReviewRequestChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');
CREATE TYPE "ReviewRequestAttemptType" AS ENUM ('INITIAL', 'REMINDER');
CREATE TYPE "ReviewRequestAttemptStatus" AS ENUM ('PENDING', 'SENDING', 'ACCEPTED', 'DELIVERED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'CANCELLED', 'SUPPRESSED');
ALTER TYPE "ReviewRequestStatus" ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE "ReviewRequestStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "ReviewRequestStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "ReviewRequestStatus" ADD VALUE IF NOT EXISTS 'OPENED';
ALTER TYPE "ReviewRequestStatus" ADD VALUE IF NOT EXISTS 'CLICKED';
ALTER TYPE "ReviewRequestStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "ReviewRequestStatus" ADD VALUE IF NOT EXISTS 'SUPPRESSED';
ALTER TYPE "ReviewRequestStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TABLE "ReviewSettings"
  ADD COLUMN "reviewRequestTrigger" "ReviewRequestTrigger" NOT NULL DEFAULT 'DELIVERED',
  ADD COLUMN "reviewRequestSendHourLocal" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "reviewRequestPrimaryChannel" "ReviewRequestChannel" NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "reviewRequestEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reviewRequestSmsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewRequestWhatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewRequestIncludeProductImage" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reviewRequestIncludeIncentiveText" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewRequestIncentiveText" TEXT,
  ADD COLUMN "reviewRequestSenderName" TEXT,
  ADD COLUMN "reviewRequestReplyToEmail" TEXT,
  ADD COLUMN "reviewRequestSubjectTemplate" TEXT,
  ADD COLUMN "reviewRequestBodyTemplate" TEXT,
  ADD COLUMN "reviewRequestReminderSubjectTemplate" TEXT,
  ADD COLUMN "reviewRequestReminderBodyTemplate" TEXT;
ALTER TABLE "ReviewRequest"
  ADD COLUMN "triggerEventType" "ReviewRequestTrigger",
  ADD COLUMN "triggerAt" TIMESTAMP(3), ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3), ADD COLUMN "openedAt" TIMESTAMP(3), ADD COLUMN "clickedAt" TIMESTAMP(3),
  ADD COLUMN "submittedAt" TIMESTAMP(3), ADD COLUMN "suppressedAt" TIMESTAMP(3), ADD COLUMN "lastReminderAt" TIMESTAMP(3),
  ADD COLUMN "claimToken" TEXT, ADD COLUMN "claimedAt" TIMESTAMP(3), ADD COLUMN "claimExpiresAt" TIMESTAMP(3), ADD COLUMN "workerId" TEXT;
CREATE TABLE "ProductReviewRequestDeliveryAttempt" (
 "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "reviewRequestId" TEXT NOT NULL, "channel" "ReviewRequestChannel" NOT NULL,
 "attemptType" "ReviewRequestAttemptType" NOT NULL, "attemptNumber" INTEGER NOT NULL, "status" "ReviewRequestAttemptStatus" NOT NULL DEFAULT 'PENDING',
 "provider" TEXT NOT NULL, "providerMessageId" TEXT, "idempotencyKey" TEXT NOT NULL, "scheduledAt" TIMESTAMP(3) NOT NULL,
 "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "nextRetryAt" TIMESTAMP(3), "errorCode" TEXT, "errorMessageSafe" TEXT,
 "claimToken" TEXT, "claimedAt" TIMESTAMP(3), "claimExpiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ProductReviewRequestDeliveryAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductReviewRequestDeliveryAttempt_shopId_idempotencyKey_key" ON "ProductReviewRequestDeliveryAttempt"("shopId", "idempotencyKey");
CREATE INDEX "ProductReviewRequestDeliveryAttempt_shopId_reviewRequestId_createdAt_idx" ON "ProductReviewRequestDeliveryAttempt"("shopId", "reviewRequestId", "createdAt");
CREATE INDEX "ProductReviewRequestDeliveryAttempt_shopId_status_nextRetryAt_idx" ON "ProductReviewRequestDeliveryAttempt"("shopId", "status", "nextRetryAt");
CREATE INDEX "ReviewRequest_shopId_status_nextAttemptAt_idx" ON "ReviewRequest"("shopId", "status", "nextAttemptAt");
ALTER TABLE "ProductReviewRequestDeliveryAttempt" ADD CONSTRAINT "ProductReviewRequestDeliveryAttempt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReviewRequestDeliveryAttempt" ADD CONSTRAINT "ProductReviewRequestDeliveryAttempt_reviewRequestId_fkey" FOREIGN KEY ("reviewRequestId") REFERENCES "ReviewRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
