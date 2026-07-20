CREATE TYPE "PromotionRewardScope" AS ENUM ('PRODUCT', 'ORDER');
CREATE TYPE "PromotionRewardMethod" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FIXED_PRICE');
CREATE TYPE "PromotionTierSelectionMode" AS ENUM ('HIGHEST_ELIGIBLE');
CREATE TYPE "PromotionTierContinuityMode" AS ENUM ('CONTINUOUS', 'ALLOW_GAPS');
CREATE TYPE "PromotionOrderDiscountBasis" AS ENUM ('ELIGIBLE_MERCHANDISE_SUBTOTAL');

ALTER TABLE "PromotionRule"
  ADD COLUMN "rewardScope" "PromotionRewardScope" NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN "rewardMethod" "PromotionRewardMethod",
  ADD COLUMN "tierSelectionMode" "PromotionTierSelectionMode",
  ADD COLUMN "tierContinuityMode" "PromotionTierContinuityMode",
  ADD COLUMN "orderDiscountBasis" "PromotionOrderDiscountBasis";

CREATE TABLE "PromotionOrderTier" (
  "id" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "promotionRuleId" TEXT NOT NULL,
  "minimumSubtotal" DECIMAL(18,4) NOT NULL,
  "maximumSubtotal" DECIMAL(18,4),
  "percentage" DECIMAL(8,4) NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionOrderTier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromotionOrderTier_promotionRuleId_publicId_key" ON "PromotionOrderTier"("promotionRuleId", "publicId");
CREATE INDEX "PromotionOrderTier_shopId_promotionRuleId_idx" ON "PromotionOrderTier"("shopId", "promotionRuleId");
CREATE INDEX "PromotionOrderTier_promotionRuleId_position_idx" ON "PromotionOrderTier"("promotionRuleId", "position");
ALTER TABLE "PromotionOrderTier" ADD CONSTRAINT "PromotionOrderTier_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionOrderTier" ADD CONSTRAINT "PromotionOrderTier_promotionRuleId_fkey" FOREIGN KEY ("promotionRuleId") REFERENCES "PromotionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
