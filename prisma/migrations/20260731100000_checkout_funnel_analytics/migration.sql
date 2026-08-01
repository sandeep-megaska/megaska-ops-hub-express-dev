-- Checkout funnel analytics foundation.
--
-- 1) Persist the pre-intent express-checkout funnel steps (add-to-cart, drawer
--    open, express-checkout click, OTP login) that today exist only as
--    client-side counters, so merchant analytics can measure drop-off before an
--    ExpressCheckoutIntent is ever created.
-- 2) Add the intent lifecycle timestamps that the existing recovery/abandonment
--    code already reads via information_schema existence guards (falling back to
--    updatedAt); this makes them real columns so time-based metrics are exact.

-- CreateEnum
CREATE TYPE "CheckoutFunnelEventType" AS ENUM ('CART_ADD', 'DRAWER_OPEN', 'EXPRESS_CLICK', 'OTP_OPEN', 'OTP_SUCCESS', 'MODAL_OPEN');

-- CreateEnum
CREATE TYPE "CheckoutFunnelSource" AS ENUM ('DRAWER', 'CART_PAGE', 'PRODUCT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CheckoutFunnelDevice" AS ENUM ('MOBILE', 'DESKTOP', 'UNKNOWN');

-- AlterTable
ALTER TABLE "ExpressCheckoutIntent"
    ADD COLUMN     "paymentPendingAt" TIMESTAMP(3),
    ADD COLUMN     "abandonedAt" TIMESTAMP(3),
    ADD COLUMN     "completedAt" TIMESTAMP(3),
    ADD COLUMN     "lastTransitionAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CheckoutFunnelEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "funnelSessionId" TEXT NOT NULL,
    "eventType" "CheckoutFunnelEventType" NOT NULL,
    "source" "CheckoutFunnelSource",
    "device" "CheckoutFunnelDevice" NOT NULL DEFAULT 'UNKNOWN',
    "customerProfileId" TEXT,
    "sessionTokenHash" TEXT,
    "phoneSnapshot" TEXT,
    "cartToken" TEXT,
    "cartValuePaise" INTEGER,
    "expressCheckoutIntentId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutFunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckoutFunnelEvent_shopId_occurredAt_idx" ON "CheckoutFunnelEvent"("shopId", "occurredAt");

-- CreateIndex
CREATE INDEX "CheckoutFunnelEvent_shopId_eventType_occurredAt_idx" ON "CheckoutFunnelEvent"("shopId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "CheckoutFunnelEvent_shopId_funnelSessionId_idx" ON "CheckoutFunnelEvent"("shopId", "funnelSessionId");

-- CreateIndex
CREATE INDEX "CheckoutFunnelEvent_shopId_customerProfileId_idx" ON "CheckoutFunnelEvent"("shopId", "customerProfileId");
