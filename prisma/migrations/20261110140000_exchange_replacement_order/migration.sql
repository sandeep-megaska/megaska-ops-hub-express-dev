-- Shopify order created for an exchange replacement.
ALTER TABLE "OrderActionRequest" ADD COLUMN "replacementShopifyOrderId" TEXT;
ALTER TABLE "OrderActionRequest" ADD COLUMN "replacementShopifyOrderName" TEXT;
