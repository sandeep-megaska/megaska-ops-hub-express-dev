-- Multi-store backend foundation (safe additive-first migration)

CREATE TABLE IF NOT EXISTS "Shop" (
  "id" TEXT NOT NULL,
  "shopDomain" TEXT NOT NULL,
  "accessToken" TEXT,
  "storefrontAccessToken" TEXT,
  "scopes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "installedAt" TIMESTAMP(3),
  "uninstalledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopDomain_key" ON "Shop"("shopDomain");

ALTER TABLE "OrderActionRequest" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE "WalletReservation" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE "GstSettings" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE "GstProductTaxMap" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE "GstOrderImport" ADD COLUMN IF NOT EXISTS "shopId" TEXT;

CREATE INDEX IF NOT EXISTS "OrderActionRequest_shopId_idx" ON "OrderActionRequest"("shopId");
CREATE INDEX IF NOT EXISTS "WalletReservation_shopId_status_expiresAt_idx" ON "WalletReservation"("shopId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "GstSettings_shopId_idx" ON "GstSettings"("shopId");
CREATE INDEX IF NOT EXISTS "GstProductTaxMap_shopId_idx" ON "GstProductTaxMap"("shopId");
CREATE INDEX IF NOT EXISTS "GstOrderImport_shopId_idx" ON "GstOrderImport"("shopId");

DROP INDEX IF EXISTS "GstProductTaxMap_shopifyProductId_shopifyVariantId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "GstProductTaxMap_shopId_shopifyProductId_shopifyVariantId_key"
  ON "GstProductTaxMap"("shopId", "shopifyProductId", "shopifyVariantId");

DROP INDEX IF EXISTS "GstOrderImport_shopifyOrderId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "GstOrderImport_shopId_shopifyOrderId_key"
  ON "GstOrderImport"("shopId", "shopifyOrderId");

ALTER TABLE "OrderActionRequest"
  ADD CONSTRAINT "OrderActionRequest_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WalletReservation"
  ADD CONSTRAINT "WalletReservation_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GstSettings"
  ADD CONSTRAINT "GstSettings_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GstProductTaxMap"
  ADD CONSTRAINT "GstProductTaxMap_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GstOrderImport"
  ADD CONSTRAINT "GstOrderImport_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
