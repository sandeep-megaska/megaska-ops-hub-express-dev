-- Shopify fulfillment (tracking) status for bulk-booked courier shipments.
ALTER TABLE "OrderCourierShipment" ADD COLUMN "shopifyFulfillmentStatus" TEXT;
ALTER TABLE "OrderCourierShipment" ADD COLUMN "shopifyFulfillmentId" TEXT;
ALTER TABLE "OrderCourierShipment" ADD COLUMN "shopifyFulfillmentError" TEXT;
ALTER TABLE "OrderCourierShipment" ADD COLUMN "shopifyFulfilledAt" TIMESTAMP(3);
