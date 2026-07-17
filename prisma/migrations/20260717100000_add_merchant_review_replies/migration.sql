-- REVIEW-1A.10: make the pre-existing one-to-one reply record safe for public projection.
ALTER TABLE "ProductReviewMerchantReply" ADD COLUMN "authorLabel" TEXT NOT NULL DEFAULT 'Store team';
ALTER TABLE "ProductReviewMerchantReply" DROP COLUMN "repliedBy", DROP COLUMN "publishedAt", DROP COLUMN "hiddenAt";
DROP INDEX IF EXISTS "ProductReviewMerchantReply_shopId_publishedAt_idx";
CREATE INDEX "ProductReviewMerchantReply_shopId_productReviewId_idx" ON "ProductReviewMerchantReply"("shopId", "productReviewId");
