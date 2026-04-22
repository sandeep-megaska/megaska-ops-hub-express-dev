-- Add shopId as nullable first so the column can be introduced safely
ALTER TABLE "OTPChallenge"
ADD COLUMN "shopId" TEXT;

-- Legacy OTP challenges are ephemeral and not reliably shop-attributable.
-- Remove them before enforcing strict shop scoping.
DELETE FROM "OTPChallenge";

-- Now enforce required shop scope
ALTER TABLE "OTPChallenge"
ALTER COLUMN "shopId" SET NOT NULL;

-- Add foreign key to Shop
ALTER TABLE "OTPChallenge"
ADD CONSTRAINT "OTPChallenge_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- Add indexes for shop-scoped OTP lookups
CREATE INDEX "OTPChallenge_shopId_idx"
ON "OTPChallenge"("shopId");

CREATE INDEX "OTPChallenge_shopId_phoneE164_idx"
ON "OTPChallenge"("shopId", "phoneE164");

CREATE INDEX "OTPChallenge_shopId_phoneE164_status_createdAt_idx"
ON "OTPChallenge"("shopId", "phoneE164", "status", "createdAt");
