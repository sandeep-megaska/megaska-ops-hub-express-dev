-- CreateEnum
CREATE TYPE "MegaskaOrderStatus" AS ENUM (
  'ORDER_CONFIRMED','PROCESSING','PACKED','READY_FOR_PICKUP','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','RTO_INITIATED','RTO_DELIVERED','CANCELLED','RETURN_REQUESTED','RETURN_IN_TRANSIT','REFUNDED'
);

-- CreateEnum
CREATE TYPE "CourierProvider" AS ENUM ('DELHIVERY','DTDC','ATS','OTHER');

-- AlterTable
ALTER TABLE "OrderActionRequest" ADD COLUMN "megaskaOrderId" TEXT;

-- CreateTable
CREATE TABLE "MegaskaOrder" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "customerProfileId" TEXT NOT NULL,
  "shopifyOrderId" TEXT,
  "shopifyOrderName" TEXT NOT NULL,
  "orderPlacedAt" TIMESTAMP(3),
  "status" "MegaskaOrderStatus" NOT NULL DEFAULT 'ORDER_CONFIRMED',
  "statusSource" TEXT,
  "statusUpdatedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MegaskaOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderShipment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" "CourierProvider" NOT NULL DEFAULT 'OTHER',
  "providerReference" TEXT,
  "awb" TEXT,
  "trackingUrl" TEXT,
  "normalizedStatus" "MegaskaOrderStatus" NOT NULL DEFAULT 'ORDER_CONFIRMED',
  "statusUpdatedAt" TIMESTAMP(3),
  "rawStatus" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderShipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderShipmentEvent" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "normalizedStatus" "MegaskaOrderStatus" NOT NULL,
  "rawStatus" TEXT,
  "description" TEXT,
  "location" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderShipmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MegaskaOrder_shopId_shopifyOrderName_key" ON "MegaskaOrder"("shopId","shopifyOrderName");
CREATE INDEX "MegaskaOrder_customerProfileId_createdAt_idx" ON "MegaskaOrder"("customerProfileId","createdAt");
CREATE INDEX "MegaskaOrder_shopifyOrderId_idx" ON "MegaskaOrder"("shopifyOrderId");
CREATE INDEX "MegaskaOrder_status_idx" ON "MegaskaOrder"("status");
CREATE INDEX "OrderShipment_orderId_createdAt_idx" ON "OrderShipment"("orderId","createdAt");
CREATE INDEX "OrderShipment_provider_providerReference_idx" ON "OrderShipment"("provider","providerReference");
CREATE INDEX "OrderShipment_awb_idx" ON "OrderShipment"("awb");
CREATE INDEX "OrderShipmentEvent_shipmentId_occurredAt_idx" ON "OrderShipmentEvent"("shipmentId","occurredAt");
CREATE INDEX "OrderActionRequest_megaskaOrderId_idx" ON "OrderActionRequest"("megaskaOrderId");

ALTER TABLE "OrderActionRequest" ADD CONSTRAINT "OrderActionRequest_megaskaOrderId_fkey" FOREIGN KEY ("megaskaOrderId") REFERENCES "MegaskaOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MegaskaOrder" ADD CONSTRAINT "MegaskaOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MegaskaOrder" ADD CONSTRAINT "MegaskaOrder_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderShipment" ADD CONSTRAINT "OrderShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MegaskaOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderShipmentEvent" ADD CONSTRAINT "OrderShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "OrderShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
