-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "displayName" TEXT,
    "acceptsEmailMarketing" BOOLEAN DEFAULT false,
    "acceptsSmsMarketing" BOOLEAN DEFAULT false,
    "ordersCount" INTEGER DEFAULT 0,
    "amountSpent" DECIMAL(12,2),
    "defaultAddressJson" JSONB,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_shopId_shopifyCustomerId_key"
ON "CustomerProfile"("shopId", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "CustomerProfile_shopId_idx"
ON "CustomerProfile"("shopId");

-- CreateIndex
CREATE INDEX "CustomerProfile_shopId_phone_idx"
ON "CustomerProfile"("shopId", "phone");

-- CreateIndex
CREATE INDEX "CustomerProfile_shopId_email_idx"
ON "CustomerProfile"("shopId", "email");

-- AddForeignKey
ALTER TABLE "CustomerProfile"
ADD CONSTRAINT "CustomerProfile_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
