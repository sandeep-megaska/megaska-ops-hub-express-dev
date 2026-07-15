CREATE TYPE "MerchantUsageType" AS ENUM ('OTP', 'EMAIL', 'SMS', 'WHATSAPP', 'AI', 'DELIVERY_LOOKUP', 'CHECKOUT_TRANSACTION');
CREATE TYPE "MerchantUsageAction" AS ENUM ('OTP_REQUEST', 'EMAIL_SEND', 'SMS_SEND', 'WHATSAPP_SEND', 'AI_REQUEST', 'DELIVERY_LOOKUP', 'CHECKOUT_TRANSACTION');
CREATE TYPE "MerchantUsageProvider" AS ENUM ('PLATFORM_TWILIO', 'PLATFORM_RESEND', 'PLATFORM_MSG91', 'MERCHANT_TWILIO', 'MERCHANT_RESEND', 'MERCHANT_MSG91', 'INTERNAL');
CREATE TYPE "MerchantUsageStatus" AS ENUM ('RECORDED', 'REVERSED', 'EXCLUDED');
CREATE TYPE "MerchantUsageBillingStatus" AS ENUM ('UNRATED', 'PENDING', 'INCLUDED', 'BILLABLE', 'SUBMITTED', 'BILLED', 'FAILED', 'EXCLUDED');

CREATE TABLE "MerchantUsageEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "usageType" "MerchantUsageType" NOT NULL,
    "action" "MerchantUsageAction" NOT NULL,
    "provider" "MerchantUsageProvider" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "status" "MerchantUsageStatus" NOT NULL DEFAULT 'RECORDED',
    "billingStatus" "MerchantUsageBillingStatus" NOT NULL DEFAULT 'UNRATED',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "countryCode" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MerchantUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantUsageEvent_idempotencyKey_key" ON "MerchantUsageEvent"("idempotencyKey");
CREATE INDEX "MerchantUsageEvent_shopId_occurredAt_idx" ON "MerchantUsageEvent"("shopId", "occurredAt");
CREATE INDEX "MerchantUsageEvent_shopId_usageType_occurredAt_idx" ON "MerchantUsageEvent"("shopId", "usageType", "occurredAt");
CREATE INDEX "MerchantUsageEvent_shopId_billingStatus_occurredAt_idx" ON "MerchantUsageEvent"("shopId", "billingStatus", "occurredAt");
CREATE INDEX "MerchantUsageEvent_sourceType_sourceId_idx" ON "MerchantUsageEvent"("sourceType", "sourceId");
CREATE INDEX "MerchantUsageEvent_provider_occurredAt_idx" ON "MerchantUsageEvent"("provider", "occurredAt");
ALTER TABLE "MerchantUsageEvent" ADD CONSTRAINT "MerchantUsageEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
