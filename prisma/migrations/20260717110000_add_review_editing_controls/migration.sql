ALTER TABLE "ReviewSettings" ADD COLUMN "customerReviewEditingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "reviewEditWindowDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "requireRemoderationAfterEdit" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_reviewEditWindowDays_check" CHECK ("reviewEditWindowDays" >= 1 AND "reviewEditWindowDays" <= 365);
ALTER TABLE "ProductReview" ADD COLUMN "lastEditedAt" TIMESTAMP(3), ADD COLUMN "editCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "lastEditedBy" TEXT;
CREATE TABLE "ProductReviewEditToken" ("id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "reviewId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "usedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "useCount" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "ProductReviewEditToken_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ProductReviewEditToken_tokenHash_key" ON "ProductReviewEditToken"("tokenHash");
CREATE INDEX "ProductReviewEditToken_shopId_reviewId_idx" ON "ProductReviewEditToken"("shopId", "reviewId");
CREATE INDEX "ProductReviewEditToken_shopId_expiresAt_idx" ON "ProductReviewEditToken"("shopId", "expiresAt");
CREATE TABLE "ProductReviewRevision" ("id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "reviewId" TEXT NOT NULL, "previousRating" INTEGER NOT NULL, "previousTitle" TEXT, "previousBody" TEXT, "newRating" INTEGER NOT NULL, "newTitle" TEXT, "newBody" TEXT, "previousStatus" TEXT NOT NULL, "newStatus" TEXT NOT NULL, "editSource" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProductReviewRevision_pkey" PRIMARY KEY ("id"));
CREATE INDEX "ProductReviewRevision_shopId_reviewId_createdAt_idx" ON "ProductReviewRevision"("shopId", "reviewId", "createdAt");
ALTER TABLE "ProductReviewEditToken" ADD CONSTRAINT "ProductReviewEditToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReviewEditToken" ADD CONSTRAINT "ProductReviewEditToken_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReviewRevision" ADD CONSTRAINT "ProductReviewRevision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
