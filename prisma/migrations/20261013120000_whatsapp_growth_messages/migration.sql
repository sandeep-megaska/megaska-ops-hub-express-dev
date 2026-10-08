-- WhatsApp back-in-stock alerts, review requests and second-order nudges.
ALTER TABLE "MerchantWhatsAppAccount"
  ADD COLUMN IF NOT EXISTS "backInStockEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reviewRequestsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "secondOrderEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "secondOrderDelayDays" INTEGER NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS "secondOrderOffer" TEXT;

CREATE TABLE IF NOT EXISTS "BackInStockRequest" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "customerName" TEXT,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "key" TEXT NOT NULL,
  "productTitle" TEXT NOT NULL,
  "variantTitle" TEXT,
  "optionSize" TEXT,
  "optionColor" TEXT,
  "productUrl" TEXT,
  "source" TEXT NOT NULL DEFAULT 'WHATSAPP_AI',
  "status" TEXT NOT NULL DEFAULT 'WAITING',
  "messageId" TEXT,
  "notifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackInStockRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackInStockRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BackInStockRequest_shopId_phone_key_key" ON "BackInStockRequest"("shopId", "phone", "key");
CREATE INDEX IF NOT EXISTS "BackInStockRequest_shopId_status_idx" ON "BackInStockRequest"("shopId", "status");
