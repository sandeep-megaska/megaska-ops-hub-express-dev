ALTER TABLE "ProductReview"
  ADD COLUMN "moderatedAt" TIMESTAMP(3),
  ADD COLUMN "moderatedBy" TEXT,
  ADD COLUMN "rejectionReason" TEXT;
