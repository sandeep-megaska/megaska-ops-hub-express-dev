-- Support explicit customer review submission source values.
ALTER TYPE "ProductReviewSource" ADD VALUE IF NOT EXISTS 'CUSTOMER_DASHBOARD';
ALTER TYPE "ProductReviewSource" ADD VALUE IF NOT EXISTS 'PRODUCT_PAGE';
ALTER TYPE "ProductReviewSource" ADD VALUE IF NOT EXISTS 'REVIEW_REQUEST_EMAIL';
ALTER TYPE "ProductReviewSource" ADD VALUE IF NOT EXISTS 'REVIEW_REQUEST_WHATSAPP';

-- Prevent duplicate reviews for the same purchased order line by the same customer in the same shop.
CREATE UNIQUE INDEX "ProductReview_shopId_customerProfileId_shopifyLineItemId_key"
  ON "ProductReview" ("shopId", "customerProfileId", "shopifyLineItemId");
