-- AlterTable
ALTER TABLE "MerchantWhatsAppAccount" ADD COLUMN     "templateAlertEmailedAt" TIMESTAMP(3),
ADD COLUMN     "templateFailingSince" TIMESTAMP(3),
ADD COLUMN     "templateFailureError" TEXT;

