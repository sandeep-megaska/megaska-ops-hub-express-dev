-- CreateEnums
CREATE TYPE "RefundSource" AS ENUM ('ORDER_ACTION_REQUEST', 'SHOPIFY_REFUND');
CREATE TYPE "RefundMethod" AS ENUM ('COD', 'PREPAID');
CREATE TYPE "RefundStatus" AS ENUM ('DETAILS_PENDING', 'DETAILS_SUBMITTED', 'REVIEW_PENDING', 'APPROVED', 'REJECTED', 'PAYOUT_PENDING', 'PAID', 'FAILED', 'CANCELLED');
CREATE TYPE "RefundPayoutRail" AS ENUM ('UPI', 'BANK_TRANSFER');
CREATE TYPE "RefundPayoutStatus" AS ENUM ('CREATED', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'CANCELLED');
CREATE TYPE "RefundActorType" AS ENUM ('SYSTEM', 'ADMIN', 'CUSTOMER');

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "source" "RefundSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "method" "RefundMethod" NOT NULL DEFAULT 'COD',
    "status" "RefundStatus" NOT NULL DEFAULT 'DETAILS_PENDING',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "amount" INTEGER NOT NULL,
    "customerProfileId" TEXT,
    "orderActionRequestId" TEXT,
    "shopifyOrderId" TEXT,
    "shopifyRefundId" TEXT,
    "reason" TEXT,
    "customerNote" TEXT,
    "adminNote" TEXT,
    "metadata" JSONB,
    "detailsSubmittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundPayoutDetails" (
    "id" TEXT NOT NULL,
    "refundRequestId" TEXT NOT NULL,
    "rail" "RefundPayoutRail" NOT NULL,
    "accountHolderName" TEXT,
    "bankAccountMasked" TEXT,
    "bankAccountEnc" TEXT,
    "bankIfsc" TEXT,
    "upiIdMasked" TEXT,
    "upiIdEnc" TEXT,
    "phoneMasked" TEXT,
    "phoneEnc" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundPayoutDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundPayout" (
    "id" TEXT NOT NULL,
    "refundRequestId" TEXT NOT NULL,
    "status" "RefundPayoutStatus" NOT NULL DEFAULT 'CREATED',
    "provider" TEXT,
    "providerReferenceId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "initiatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundEvent" (
    "id" TEXT NOT NULL,
    "refundRequestId" TEXT NOT NULL,
    "actorType" "RefundActorType" NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "fromStatus" "RefundStatus",
    "toStatus" "RefundStatus",
    "message" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequest_shopId_source_sourceId_key" ON "RefundRequest"("shopId", "source", "sourceId");
CREATE INDEX "RefundRequest_shopId_status_createdAt_idx" ON "RefundRequest"("shopId", "status", "createdAt");
CREATE INDEX "RefundRequest_customerProfileId_createdAt_idx" ON "RefundRequest"("customerProfileId", "createdAt");
CREATE INDEX "RefundRequest_orderActionRequestId_idx" ON "RefundRequest"("orderActionRequestId");
CREATE UNIQUE INDEX "RefundPayoutDetails_refundRequestId_key" ON "RefundPayoutDetails"("refundRequestId");
CREATE INDEX "RefundPayout_refundRequestId_createdAt_idx" ON "RefundPayout"("refundRequestId", "createdAt");
CREATE INDEX "RefundPayout_status_createdAt_idx" ON "RefundPayout"("status", "createdAt");
CREATE INDEX "RefundEvent_refundRequestId_createdAt_idx" ON "RefundEvent"("refundRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderActionRequestId_fkey" FOREIGN KEY ("orderActionRequestId") REFERENCES "OrderActionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefundPayoutDetails" ADD CONSTRAINT "RefundPayoutDetails_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundPayout" ADD CONSTRAINT "RefundPayout_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundEvent" ADD CONSTRAINT "RefundEvent_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
