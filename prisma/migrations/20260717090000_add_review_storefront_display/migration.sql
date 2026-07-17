ALTER TABLE "ReviewSettings"
  ADD COLUMN "storefrontReviewsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showReviewSummary" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showRatingDistribution" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showVerifiedPurchaseBadge" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reviewsPerPage" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "defaultReviewSort" TEXT NOT NULL DEFAULT 'NEWEST',
  ADD COLUMN "showReviewDates" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showVariantTitle" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_reviewsPerPage_check" CHECK ("reviewsPerPage" >= 1 AND "reviewsPerPage" <= 25);
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_defaultReviewSort_check" CHECK ("defaultReviewSort" IN ('NEWEST', 'HIGHEST_RATING', 'LOWEST_RATING'));
