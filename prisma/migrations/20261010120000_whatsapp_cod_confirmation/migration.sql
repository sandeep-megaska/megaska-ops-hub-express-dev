-- WhatsApp COD order confirmation switch and template name per shop.
ALTER TABLE "MerchantWhatsAppAccount" ADD COLUMN "codConfirmEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MerchantWhatsAppAccount" ADD COLUMN "codConfirmTemplate" TEXT NOT NULL DEFAULT 'cod_order_confirmation';
