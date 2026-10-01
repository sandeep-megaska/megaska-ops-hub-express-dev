-- Bulk outbound courier booking (admin Shipments page).
CREATE TYPE "OrderCourierShipmentStatus" AS ENUM ('CREATING', 'CREATED', 'FAILED');

CREATE TABLE "OrderCourierShipment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL,
    "provider" "CourierProvider" NOT NULL DEFAULT 'DELHIVERY',
    "status" "OrderCourierShipmentStatus" NOT NULL DEFAULT 'CREATING',
    "awb" TEXT,
    "trackingUrl" TEXT,
    "providerReference" TEXT,
    "paymentMode" TEXT NOT NULL,
    "codAmountPaise" INTEGER NOT NULL DEFAULT 0,
    "weightGrams" INTEGER,
    "shippingMode" TEXT,
    "errorMessage" TEXT,
    "rawResponse" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderCourierShipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderCourierShipment_shopId_shopifyOrderId_provider_key" ON "OrderCourierShipment"("shopId", "shopifyOrderId", "provider");
CREATE INDEX "OrderCourierShipment_shopId_createdAt_idx" ON "OrderCourierShipment"("shopId", "createdAt");
CREATE INDEX "OrderCourierShipment_awb_idx" ON "OrderCourierShipment"("awb");

ALTER TABLE "OrderCourierShipment" ADD CONSTRAINT "OrderCourierShipment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
