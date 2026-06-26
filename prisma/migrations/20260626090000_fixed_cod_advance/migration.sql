CREATE TYPE "CodAdvanceStatus" AS ENUM ('CREATED', 'PAYMENT_PENDING', 'ADVANCE_PAID', 'ORDER_LINKED', 'FAILED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "CodAdvanceSettings" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "fixedAdvanceAmountPaise" INTEGER NOT NULL DEFAULT 12000,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "minOrderAmountPaise" INTEGER,
  "maxOrderAmountPaise" INTEGER,
  "policyText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodAdvanceSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CodAdvanceIntent" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "customerProfileId" TEXT,
  "cartReference" TEXT,
  "checkoutReference" TEXT,
  "shopifyOrderId" TEXT,
  "shopifyOrderName" TEXT,
  "orderAmountPaise" INTEGER NOT NULL,
  "advanceAmountPaise" INTEGER NOT NULL,
  "codBalanceAmountPaise" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" "CodAdvanceStatus" NOT NULL DEFAULT 'CREATED',
  "razorpayPaymentLinkId" TEXT,
  "razorpayPaymentLinkUrl" TEXT,
  "razorpayPaymentId" TEXT,
  "providerReferenceId" TEXT,
  "paidAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodAdvanceIntent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CodAdvanceSettings_shopId_idx" ON "CodAdvanceSettings"("shopId");
CREATE INDEX "CodAdvanceIntent_shopId_idx" ON "CodAdvanceIntent"("shopId");
CREATE INDEX "CodAdvanceIntent_status_idx" ON "CodAdvanceIntent"("status");
CREATE INDEX "CodAdvanceIntent_razorpayPaymentLinkId_idx" ON "CodAdvanceIntent"("razorpayPaymentLinkId");
CREATE INDEX "CodAdvanceIntent_shopifyOrderId_idx" ON "CodAdvanceIntent"("shopifyOrderId");
CREATE INDEX "CodAdvanceIntent_customerProfileId_createdAt_idx" ON "CodAdvanceIntent"("customerProfileId", "createdAt");

ALTER TABLE "CodAdvanceSettings" ADD CONSTRAINT "CodAdvanceSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodAdvanceIntent" ADD CONSTRAINT "CodAdvanceIntent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodAdvanceIntent" ADD CONSTRAINT "CodAdvanceIntent_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
