-- WhatsApp shop in chat: the Meta catalog id used for product cards.
ALTER TABLE "MerchantWhatsAppAccount" ADD COLUMN IF NOT EXISTS "catalogId" TEXT;
