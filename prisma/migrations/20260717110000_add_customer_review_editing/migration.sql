-- REVIEW-1A.11: token-gated customer edits with immutable revision records.
ALTER TABLE "ReviewSettings" ADD COLUMN "reviewEditWindowDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "ProductReview" ADD COLUMN "editCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "lastEditedAt" TIMESTAMP(3), ADD COLUMN "editVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_reviewEditWindowDays_check" CHECK ("reviewEditWindowDays" >= 1 AND "reviewEditWindowDays" <= 90);
CREATE TABLE "ProductReviewEditToken" ("id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "productReviewId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProductReviewEditToken_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ProductReviewRevision" ("id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "productReviewId" TEXT NOT NULL, "previousRating" INTEGER NOT NULL, "previousTitle" TEXT, "previousBody" TEXT, "nextRating" INTEGER NOT NULL, "nextTitle" TEXT, "nextBody" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProductReviewRevision_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ProductReviewEditToken_tokenHash_key" ON "ProductReviewEditToken"("tokenHash");
CREATE INDEX "ProductReviewEditToken_shopId_productReviewId_expiresAt_idx" ON "ProductReviewEditToken"("shopId", "productReviewId", "expiresAt");
CREATE INDEX "ProductReviewRevision_shopId_productReviewId_createdAt_idx" ON "ProductReviewRevision"("shopId", "productReviewId", "createdAt");
ALTER TABLE "ProductReviewEditToken" ADD CONSTRAINT "ProductReviewEditToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReviewEditToken" ADD CONSTRAINT "ProductReviewEditToken_productReviewId_fkey" FOREIGN KEY ("productReviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReviewRevision" ADD CONSTRAINT "ProductReviewRevision_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReviewRevision" ADD CONSTRAINT "ProductReviewRevision_productReviewId_fkey" FOREIGN KEY ("productReviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
