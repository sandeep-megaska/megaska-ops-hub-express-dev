-- CreateTable
CREATE TABLE "MerchantRatedUsage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "billingPeriodId" TEXT NOT NULL,
    "pricingPlanId" TEXT NOT NULL,
    "billableFeatureId" TEXT NOT NULL,
    "featureCodeSnapshot" TEXT NOT NULL,
    "featureNameSnapshot" TEXT,
    "planCodeSnapshot" TEXT NOT NULL,
    "planNameSnapshot" TEXT,
    "currency" TEXT NOT NULL,
    "usedQuantity" DECIMAL(18,6) NOT NULL,
    "includedQuantity" DECIMAL(18,6) NOT NULL,
    "billableQuantity" DECIMAL(18,6) NOT NULL,
    "unitRate" DECIMAL(18,6) NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "usageEventCount" INTEGER NOT NULL,
    "ratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantRatedUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantRatedUsage_billingPeriodId_billableFeatureId_key" ON "MerchantRatedUsage"("billingPeriodId", "billableFeatureId");
CREATE INDEX "MerchantRatedUsage_shopId_billingPeriodId_idx" ON "MerchantRatedUsage"("shopId", "billingPeriodId");
CREATE INDEX "MerchantRatedUsage_pricingPlanId_idx" ON "MerchantRatedUsage"("pricingPlanId");
CREATE INDEX "MerchantRatedUsage_featureCodeSnapshot_idx" ON "MerchantRatedUsage"("featureCodeSnapshot");

ALTER TABLE "MerchantRatedUsage" ADD CONSTRAINT "MerchantRatedUsage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantRatedUsage" ADD CONSTRAINT "MerchantRatedUsage_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "MerchantBillingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantRatedUsage" ADD CONSTRAINT "MerchantRatedUsage_pricingPlanId_fkey" FOREIGN KEY ("pricingPlanId") REFERENCES "PricingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantRatedUsage" ADD CONSTRAINT "MerchantRatedUsage_billableFeatureId_fkey" FOREIGN KEY ("billableFeatureId") REFERENCES "BillableFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
