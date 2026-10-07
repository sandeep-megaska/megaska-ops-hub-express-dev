-- WhatsApp shipped / out for delivery / delivery attempt failed / delivered updates switch per shop.
ALTER TABLE "MerchantWhatsAppAccount" ADD COLUMN "shippingUpdatesEnabled" BOOLEAN NOT NULL DEFAULT false;
