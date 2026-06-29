CREATE TYPE "CheckoutRecoveryType" AS ENUM ('CHECKOUT_ABANDONMENT', 'PAYMENT_ABANDONMENT');
CREATE TYPE "CheckoutRecoveryTokenStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

CREATE TABLE "CheckoutRecoveryToken" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "checkoutIntentId" TEXT NOT NULL,
  "customerProfileId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "recoveryType" "CheckoutRecoveryType" NOT NULL,
  "status" "CheckoutRecoveryTokenStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "clickedAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,

  CONSTRAINT "CheckoutRecoveryToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutRecoveryToken_tokenHash_key" ON "CheckoutRecoveryToken"("tokenHash");
CREATE INDEX "CheckoutRecoveryToken_shopId_tokenHash_status_idx" ON "CheckoutRecoveryToken"("shopId", "tokenHash", "status");
CREATE INDEX "CheckoutRecoveryToken_shopId_checkoutIntentId_idx" ON "CheckoutRecoveryToken"("shopId", "checkoutIntentId");
CREATE UNIQUE INDEX "CheckoutRecoveryToken_one_active_per_intent_type" ON "CheckoutRecoveryToken"("checkoutIntentId", "recoveryType") WHERE "status" = 'ACTIVE';

ALTER TABLE "CheckoutRecoveryToken" ADD CONSTRAINT "CheckoutRecoveryToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckoutRecoveryToken" ADD CONSTRAINT "CheckoutRecoveryToken_checkoutIntentId_fkey" FOREIGN KEY ("checkoutIntentId") REFERENCES "ExpressCheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckoutRecoveryToken" ADD CONSTRAINT "CheckoutRecoveryToken_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
