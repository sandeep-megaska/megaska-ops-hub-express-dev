-- CreateEnum
CREATE TYPE "ShopifyCheckoutPricingSnapshotStatus" AS ENUM ('CURRENT', 'INVALIDATED');

-- CreateTable
CREATE TABLE "ShopifyCheckoutPricingSnapshot" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "checkoutIntentId" TEXT NOT NULL,
    "shopifyDraftOrderId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SHOPIFY',
    "status" "ShopifyCheckoutPricingSnapshotStatus" NOT NULL DEFAULT 'CURRENT',
    "currency" TEXT,
    "subtotalMinor" INTEGER,
    "discountsMinor" INTEGER,
    "shippingMinor" INTEGER,
    "totalTaxMinor" INTEGER,
    "totalPayableMinor" INTEGER,
    "taxesIncluded" BOOLEAN,
    "taxSummary" JSONB,
    "cartFingerprint" TEXT,
    "addressFingerprint" TEXT,
    "shippingFingerprint" TEXT,
    "discountFingerprint" TEXT,
    "storeCreditFingerprint" TEXT,
    "refreshReason" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,
    "authoritativeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopifyCheckoutPricingSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopifyCheckoutPricingSnapshot_publicId_key" ON "ShopifyCheckoutPricingSnapshot"("publicId");
CREATE UNIQUE INDEX "ShopifyCheckoutPricingSnapshot_shopId_checkoutIntentId_key" ON "ShopifyCheckoutPricingSnapshot"("shopId", "checkoutIntentId");
CREATE UNIQUE INDEX "ExpressCheckoutIntent_shopId_id_key" ON "ExpressCheckoutIntent"("shopId", "id");
CREATE INDEX "ShopifyCheckoutPricingSnapshot_shopId_status_idx" ON "ShopifyCheckoutPricingSnapshot"("shopId", "status");
CREATE INDEX "ShopifyCheckoutPricingSnapshot_shopId_shopifyDraftOrderId_idx" ON "ShopifyCheckoutPricingSnapshot"("shopId", "shopifyDraftOrderId");

ALTER TABLE "ShopifyCheckoutPricingSnapshot" ADD CONSTRAINT "ShopifyCheckoutPricingSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopifyCheckoutPricingSnapshot" ADD CONSTRAINT "ShopifyCheckoutPricingSnapshot_shopId_checkoutIntentId_fkey" FOREIGN KEY ("shopId", "checkoutIntentId") REFERENCES "ExpressCheckoutIntent"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
