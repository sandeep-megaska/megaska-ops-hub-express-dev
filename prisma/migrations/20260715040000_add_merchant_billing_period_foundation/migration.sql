-- CreateEnum
CREATE TYPE "MerchantBillingPeriodStatus" AS ENUM ('OPEN', 'RATING', 'RATED', 'CLOSED', 'VOID');

-- CreateTable
CREATE TABLE "MerchantBillingPeriod" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "MerchantBillingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ratedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantBillingPeriod_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MerchantBillingPeriod_period_range_check" CHECK ("periodEnd" > "periodStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantBillingPeriod_subscriptionId_periodStart_periodEnd_key" ON "MerchantBillingPeriod"("subscriptionId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "MerchantBillingPeriod_shopId_status_idx" ON "MerchantBillingPeriod"("shopId", "status");

-- CreateIndex
CREATE INDEX "MerchantBillingPeriod_subscriptionId_status_idx" ON "MerchantBillingPeriod"("subscriptionId", "status");

-- CreateIndex
CREATE INDEX "MerchantBillingPeriod_shopId_periodStart_periodEnd_idx" ON "MerchantBillingPeriod"("shopId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "MerchantBillingPeriod_periodEnd_idx" ON "MerchantBillingPeriod"("periodEnd");

-- AddForeignKey
ALTER TABLE "MerchantBillingPeriod" ADD CONSTRAINT "MerchantBillingPeriod_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantBillingPeriod" ADD CONSTRAINT "MerchantBillingPeriod_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "MerchantSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
