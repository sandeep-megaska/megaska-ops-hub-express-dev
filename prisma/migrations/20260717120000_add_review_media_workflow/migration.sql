-- REVIEW-1A.12: tenant-scoped review media upload and moderation state.
CREATE TYPE "ProductReviewMediaStatus" AS ENUM ('UPLOADING', 'READY', 'PROCESSING', 'REJECTED', 'FAILED', 'DELETED');
ALTER TABLE "ReviewSettings"
  ADD COLUMN "reviewMediaEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reviewPhotoUploadsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reviewVideoUploadsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reviewMaxMediaItems" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "reviewMaxPhotoSizeBytes" INTEGER NOT NULL DEFAULT 8388608,
  ADD COLUMN "reviewMaxVideoSizeBytes" INTEGER NOT NULL DEFAULT 41943040,
  ADD COLUMN "reviewMaxVideoDurationSeconds" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "ProductReviewMedia" ADD COLUMN "status" "ProductReviewMediaStatus" NOT NULL DEFAULT 'UPLOADING', ADD COLUMN "moderationNote" TEXT;
UPDATE "ProductReviewMedia" SET "status" = CASE WHEN "deletedAt" IS NOT NULL THEN 'DELETED'::"ProductReviewMediaStatus" WHEN "rejectedAt" IS NOT NULL THEN 'REJECTED'::"ProductReviewMediaStatus" WHEN "approved" THEN 'READY'::"ProductReviewMediaStatus" ELSE 'FAILED'::"ProductReviewMediaStatus" END;
ALTER TABLE "ProductReviewRevision" ADD COLUMN "mediaChanges" JSONB;
CREATE INDEX "ProductReviewMedia_shopId_status_idx" ON "ProductReviewMedia"("shopId", "status");
CREATE INDEX "ProductReviewMedia_shopId_createdAt_idx" ON "ProductReviewMedia"("shopId", "createdAt");
CREATE UNIQUE INDEX "ProductReviewMedia_productReviewId_sortOrder_key" ON "ProductReviewMedia"("productReviewId", "sortOrder");
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_reviewMaxMediaItems_check" CHECK ("reviewMaxMediaItems" >= 1 AND "reviewMaxMediaItems" <= 10);
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_reviewMaxVideoDurationSeconds_check" CHECK ("reviewMaxVideoDurationSeconds" >= 5 AND "reviewMaxVideoDurationSeconds" <= 120);
