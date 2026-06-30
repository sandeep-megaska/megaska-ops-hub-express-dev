-- Extend wallet source coverage for schema-only SC-1.3 flows.
ALTER TYPE "WalletSourceType" ADD VALUE IF NOT EXISTS 'REFUND_REQUEST';
ALTER TYPE "WalletSourceType" ADD VALUE IF NOT EXISTS 'CHECKOUT_INTENT';
ALTER TYPE "WalletSourceType" ADD VALUE IF NOT EXISTS 'SHOPIFY_ORDER';

-- Add shop scoping as nullable first so existing data can be backfilled safely.
ALTER TABLE "WalletAccount" ADD COLUMN "shopId" TEXT;
ALTER TABLE "WalletTransaction" ADD COLUMN "shopId" TEXT;
ALTER TABLE "RefundRequest" ADD COLUMN "walletTransactionId" TEXT;

-- Backfill wallet shop scope from CustomerProfile.shopId without assuming tables are empty.
UPDATE "WalletAccount" wa
SET "shopId" = cp."shopId"
FROM "CustomerProfile" cp
WHERE wa."customerProfileId" = cp."id"
  AND wa."shopId" IS NULL
  AND cp."shopId" IS NOT NULL;

UPDATE "WalletTransaction" wt
SET "shopId" = cp."shopId"
FROM "CustomerProfile" cp
WHERE wt."customerProfileId" = cp."id"
  AND wt."shopId" IS NULL
  AND cp."shopId" IS NOT NULL;

-- Refuse to tighten nullability if any existing rows cannot be safely scoped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "WalletAccount" WHERE "shopId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot set WalletAccount.shopId NOT NULL: at least one existing wallet account has no CustomerProfile.shopId to backfill';
  END IF;

  IF EXISTS (SELECT 1 FROM "WalletTransaction" WHERE "shopId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot set WalletTransaction.shopId NOT NULL: at least one existing wallet transaction has no CustomerProfile.shopId to backfill';
  END IF;
END $$;

ALTER TABLE "WalletAccount" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "WalletTransaction" ALTER COLUMN "shopId" SET NOT NULL;

-- Replace customer-only wallet account uniqueness with shop-scoped uniqueness.
DROP INDEX IF EXISTS "WalletAccount_customerProfileId_currency_key";
CREATE UNIQUE INDEX "WalletAccount_shopId_customerProfileId_currency_key" ON "WalletAccount"("shopId", "customerProfileId", "currency");

-- Add shop-scoped lookup indexes.
CREATE INDEX "WalletAccount_shopId_idx" ON "WalletAccount"("shopId");
CREATE INDEX "WalletTransaction_shopId_customerProfileId_createdAt_idx" ON "WalletTransaction"("shopId", "customerProfileId", "createdAt");
CREATE INDEX "WalletTransaction_shopId_sourceType_sourceId_idx" ON "WalletTransaction"("shopId", "sourceType", "sourceId");
CREATE INDEX "RefundRequest_walletTransactionId_idx" ON "RefundRequest"("walletTransactionId");

-- Add relations after the backfill and nullability checks.
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
