-- 1) Add new column
ALTER TABLE "CustomerProfile"
ADD COLUMN "shopId" TEXT;

-- 2) Add index support for shop-scoped reads
CREATE INDEX "CustomerProfile_shopId_idx"
ON "CustomerProfile"("shopId");

CREATE INDEX "CustomerProfile_shopId_phoneE164_idx"
ON "CustomerProfile"("shopId", "phoneE164");

CREATE INDEX "CustomerProfile_shopId_email_idx"
ON "CustomerProfile"("shopId", "email");

-- 3) Add unique sync identity
CREATE UNIQUE INDEX "CustomerProfile_shopId_shopifyCustomerId_key"
ON "CustomerProfile"("shopId", "shopifyCustomerId");

-- 4) Add foreign key
ALTER TABLE "CustomerProfile"
ADD CONSTRAINT "CustomerProfile_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
