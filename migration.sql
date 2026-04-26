-- Generated via Prisma migrate diff intent: add missing GstSkuTaxMap model support.

CREATE TABLE "GstSkuTaxMap" (
  "id" TEXT NOT NULL,
  "shopId" TEXT,
  "sku" TEXT,
  "styleCode" TEXT,
  "hsnCode" TEXT NOT NULL,
  "taxRate" DECIMAL(5,2) NOT NULL,
  "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'BULK_CSV',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GstSkuTaxMap_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GstSkuTaxMap_shopId_sku_idx" ON "GstSkuTaxMap"("shopId", "sku");
CREATE INDEX "GstSkuTaxMap_shopId_styleCode_idx" ON "GstSkuTaxMap"("shopId", "styleCode");
CREATE INDEX "GstSkuTaxMap_status_idx" ON "GstSkuTaxMap"("status");

ALTER TABLE "GstSkuTaxMap"
  ADD CONSTRAINT "GstSkuTaxMap_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
