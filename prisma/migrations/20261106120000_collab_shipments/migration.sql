-- CreateTable
CREATE TABLE "CollabShipment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "recipientHandle" TEXT,
    "platform" TEXT,
    "campaign" TEXT,
    "address" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "retailValuePaise" INTEGER NOT NULL DEFAULT 0,
    "productCostPaise" INTEGER NOT NULL DEFAULT 0,
    "shippingCostPaise" INTEGER,
    "weightGrams" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "errorMessage" TEXT,
    "shopifyOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "awb" TEXT,
    "trackingUrl" TEXT,
    "trackingStatus" "MegaskaOrderStatus",
    "trackingRawStatus" TEXT,
    "trackingUpdatedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliverableStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "contentUrl" TEXT,
    "postedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollabShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollabShipment_shopId_createdAt_idx" ON "CollabShipment"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "CollabShipment_awb_idx" ON "CollabShipment"("awb");

-- CreateIndex
CREATE UNIQUE INDEX "CollabShipment_shopId_shopifyOrderId_key" ON "CollabShipment"("shopId", "shopifyOrderId");

-- AddForeignKey
ALTER TABLE "CollabShipment" ADD CONSTRAINT "CollabShipment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

