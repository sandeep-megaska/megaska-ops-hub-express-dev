-- CreateTable
CREATE TABLE "MerchantNotificationSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customerEmailsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "senderDisplayName" TEXT,
    "replyToEmail" TEXT,
    "adminRecipients" TEXT[] NOT NULL,
    "cancellationAlerts" BOOLEAN NOT NULL DEFAULT true,
    "exchangeAlerts" BOOLEAN NOT NULL DEFAULT true,
    "issueAlerts" BOOLEAN NOT NULL DEFAULT true,
    "storeCreditAlerts" BOOLEAN NOT NULL DEFAULT true,
    "checkoutAlerts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantNotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantNotificationSettings_shopId_key" ON "MerchantNotificationSettings"("shopId");

-- CreateIndex
CREATE INDEX "MerchantNotificationSettings_shopId_idx" ON "MerchantNotificationSettings"("shopId");

-- AddForeignKey
ALTER TABLE "MerchantNotificationSettings" ADD CONSTRAINT "MerchantNotificationSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
