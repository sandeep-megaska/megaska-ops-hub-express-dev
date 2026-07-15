-- CreateEnum
CREATE TYPE "OtpProviderMode" AS ENUM ('PLATFORM_TWILIO', 'MERCHANT_TWILIO', 'MERCHANT_MSG91', 'MOCK');

-- CreateEnum
CREATE TYPE "OtpProviderStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE', 'SUSPENDED', 'ERROR');

-- CreateTable
CREATE TABLE "MerchantOtpSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "otpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "providerMode" "OtpProviderMode" NOT NULL DEFAULT 'PLATFORM_TWILIO',
    "allowPlatformFallback" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantOtpSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantTwilioSettings" (
    "id" TEXT NOT NULL,
    "merchantOtpSettingsId" TEXT NOT NULL,
    "accountSidMasked" TEXT,
    "accountSidEncrypted" TEXT,
    "authTokenEncrypted" TEXT,
    "verifyServiceSidMasked" TEXT,
    "verifyServiceSidEncrypted" TEXT,
    "status" "OtpProviderStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "verifiedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerificationErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantTwilioSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantMsg91Settings" (
    "id" TEXT NOT NULL,
    "merchantOtpSettingsId" TEXT NOT NULL,
    "authKeyEncrypted" TEXT,
    "templateIdMasked" TEXT,
    "templateIdEncrypted" TEXT,
    "senderId" TEXT,
    "status" "OtpProviderStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "kycApproved" BOOLEAN NOT NULL DEFAULT false,
    "dltApproved" BOOLEAN NOT NULL DEFAULT false,
    "templateApproved" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "lastVerificationErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantMsg91Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantOtpSettings_shopId_key" ON "MerchantOtpSettings"("shopId");
CREATE INDEX "MerchantOtpSettings_shopId_idx" ON "MerchantOtpSettings"("shopId");
CREATE UNIQUE INDEX "MerchantTwilioSettings_merchantOtpSettingsId_key" ON "MerchantTwilioSettings"("merchantOtpSettingsId");
CREATE UNIQUE INDEX "MerchantMsg91Settings_merchantOtpSettingsId_key" ON "MerchantMsg91Settings"("merchantOtpSettingsId");

-- AddForeignKey
ALTER TABLE "MerchantOtpSettings" ADD CONSTRAINT "MerchantOtpSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantTwilioSettings" ADD CONSTRAINT "MerchantTwilioSettings_merchantOtpSettingsId_fkey" FOREIGN KEY ("merchantOtpSettingsId") REFERENCES "MerchantOtpSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantMsg91Settings" ADD CONSTRAINT "MerchantMsg91Settings_merchantOtpSettingsId_fkey" FOREIGN KEY ("merchantOtpSettingsId") REFERENCES "MerchantOtpSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
