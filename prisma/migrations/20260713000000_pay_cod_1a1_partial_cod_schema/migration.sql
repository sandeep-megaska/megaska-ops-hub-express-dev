-- CreateEnum
CREATE TYPE "CodAdvanceType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "ExpressCheckoutPaymentPurpose" AS ENUM ('ORDER_PREPAID', 'COD_ADVANCE');

-- AlterTable
ALTER TABLE "CodAdvanceSettings" ADD COLUMN "advanceType" "CodAdvanceType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN "percentageBasisPoints" INTEGER,
ADD COLUMN "minimumAdvanceAmountPaise" INTEGER,
ADD COLUMN "maximumAdvanceAmountPaise" INTEGER,
ADD COLUMN "customerTitle" TEXT,
ADD COLUMN "customerMessage" TEXT,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "CodAdvanceIntent" ADD COLUMN "expressCheckoutIntentId" TEXT,
ADD COLUMN "settingsId" TEXT,
ADD COLUMN "settingsVersion" INTEGER,
ADD COLUMN "advanceType" "CodAdvanceType",
ADD COLUMN "advanceValueSnapshot" INTEGER,
ADD COLUMN "pricingFingerprint" TEXT,
ADD COLUMN "cartFingerprint" TEXT,
ADD COLUMN "merchandiseAmountPaise" INTEGER,
ADD COLUMN "shopifyDiscountAmountPaise" INTEGER,
ADD COLUMN "shippingAmountPaise" INTEGER,
ADD COLUMN "codFeeAmountPaise" INTEGER,
ADD COLUMN "storeCreditAppliedPaise" INTEGER,
ADD COLUMN "customerCashLiabilityPaise" INTEGER,
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "consumedAt" TIMESTAMP(3),
ADD COLUMN "shopifyDraftOrderId" TEXT,
ADD COLUMN "failureCode" TEXT,
ADD COLUMN "failureMessage" TEXT;

-- AlterTable
ALTER TABLE "ExpressCheckoutPayment" ADD COLUMN "purpose" "ExpressCheckoutPaymentPurpose" NOT NULL DEFAULT 'ORDER_PREPAID',
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "providerAmountPaise" INTEGER,
ADD COLUMN "providerCurrency" TEXT;

-- CreateIndex
CREATE INDEX "CodAdvanceIntent_shopId_expressCheckoutIntentId_idx" ON "CodAdvanceIntent"("shopId", "expressCheckoutIntentId");

-- CreateIndex
CREATE INDEX "CodAdvanceIntent_shopId_status_expiresAt_idx" ON "CodAdvanceIntent"("shopId", "status", "expiresAt");
