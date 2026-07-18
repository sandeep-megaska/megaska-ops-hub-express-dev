-- Add secure review-request token lifecycle metadata.
ALTER TABLE "ReviewRequest" ADD COLUMN "tokenCreatedAt" TIMESTAMP(3);
ALTER TABLE "ReviewRequest" ADD COLUMN "tokenConsumedAt" TIMESTAMP(3);
ALTER TABLE "ReviewRequest" ADD COLUMN "tokenRevokedAt" TIMESTAMP(3);
ALTER TABLE "ReviewRequest" ADD COLUMN "submittedReviewId" TEXT;
