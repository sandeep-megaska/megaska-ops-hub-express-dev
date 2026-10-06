-- Per-merchant WhatsApp Business number. Additive: no existing table changes.
ALTER TYPE "MerchantUsageProvider" ADD VALUE IF NOT EXISTS 'MERCHANT_WHATSAPP';

CREATE TABLE IF NOT EXISTS "MerchantWhatsAppAccount" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "displayPhoneNumber" TEXT,
    "phoneNumberId" TEXT NOT NULL,
    "businessAccountId" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "accessTokenMasked" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'en',
    "otpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "otpTemplateName" TEXT NOT NULL DEFAULT 'loopd2c_login_otp',
    "recoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recoveryFirstTemplate" TEXT NOT NULL DEFAULT 'checkout_recovery',
    "recoveryReminderTemplate" TEXT NOT NULL DEFAULT 'checkout_recovery_reminder',
    "exchangeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckStatus" TEXT,
    "lastCheckMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MerchantWhatsAppAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MerchantWhatsAppAccount_shopId_key" ON "MerchantWhatsAppAccount"("shopId");

DO $$ BEGIN
  ALTER TABLE "MerchantWhatsAppAccount" ADD CONSTRAINT "MerchantWhatsAppAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
