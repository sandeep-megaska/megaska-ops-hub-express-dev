ALTER TABLE "Shop" ADD COLUMN "myshopifyDomain" TEXT;
ALTER TABLE "Shop" ADD COLUMN "primaryDomain" TEXT;
ALTER TABLE "Shop" ADD COLUMN "shopName" TEXT;
ALTER TABLE "Shop" ADD COLUMN "accessTokenEncrypted" TEXT;
ALTER TABLE "Shop" ADD COLUMN "storefrontTokenEncrypted" TEXT;
ALTER TABLE "Shop" ADD COLUMN "appProxyPrefix" TEXT;
ALTER TABLE "Shop" ADD COLUMN "appProxySubpath" TEXT;
ALTER TABLE "Shop" ADD COLUMN "appProxyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN "installationStatus" TEXT NOT NULL DEFAULT 'DEV';
ALTER TABLE "Shop" ADD COLUMN "checkoutEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "Shop" ADD COLUMN "tokenRotationRequiredAt" TIMESTAMP(3);

CREATE TABLE "ShopModuleConfig" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "moduleKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopModuleConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopProxyRoute" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "routeKey" TEXT NOT NULL,
  "proxyPrefix" TEXT NOT NULL,
  "proxySubpath" TEXT NOT NULL,
  "targetModule" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopProxyRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopInstallationEvent" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "scopes" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopInstallationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shop_myshopifyDomain_key" ON "Shop"("myshopifyDomain");
CREATE UNIQUE INDEX "ShopModuleConfig_shopId_moduleKey_key" ON "ShopModuleConfig"("shopId", "moduleKey");
CREATE INDEX "ShopModuleConfig_shopId_idx" ON "ShopModuleConfig"("shopId");
CREATE INDEX "ShopModuleConfig_moduleKey_enabled_idx" ON "ShopModuleConfig"("moduleKey", "enabled");
CREATE UNIQUE INDEX "ShopProxyRoute_shopId_routeKey_key" ON "ShopProxyRoute"("shopId", "routeKey");
CREATE INDEX "ShopProxyRoute_shopId_isActive_idx" ON "ShopProxyRoute"("shopId", "isActive");
CREATE INDEX "ShopProxyRoute_targetModule_isActive_idx" ON "ShopProxyRoute"("targetModule", "isActive");
CREATE INDEX "ShopInstallationEvent_shopId_createdAt_idx" ON "ShopInstallationEvent"("shopId", "createdAt");
CREATE INDEX "ShopInstallationEvent_eventType_createdAt_idx" ON "ShopInstallationEvent"("eventType", "createdAt");

ALTER TABLE "ShopModuleConfig" ADD CONSTRAINT "ShopModuleConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopProxyRoute" ADD CONSTRAINT "ShopProxyRoute_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopInstallationEvent" ADD CONSTRAINT "ShopInstallationEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
