-- WhatsApp shop in chat: catalog carts become a Shopify bag link.
ALTER TABLE "MerchantWhatsAppAccount" ADD COLUMN IF NOT EXISTS "shopInChatEnabled" BOOLEAN NOT NULL DEFAULT false;
