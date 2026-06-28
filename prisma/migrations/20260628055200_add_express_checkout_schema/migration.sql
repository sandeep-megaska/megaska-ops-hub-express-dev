CREATE TYPE "ExpressCheckoutIntentStatus" AS ENUM ('CREATED', 'CUSTOMER_AUTHENTICATED', 'CART_SNAPSHOT_LOCKED', 'ADDRESS_CAPTURED', 'DISCOUNT_APPLIED', 'PAYMENT_METHOD_SELECTED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'ORDER_CREATING', 'ORDER_CREATED', 'FAILED', 'EXPIRED', 'CANCELLED');

CREATE TYPE "ExpressCheckoutPaymentMethod" AS ENUM ('PREPAID', 'COD');

CREATE TYPE "ExpressCheckoutPaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED');

CREATE TYPE "ExpressCheckoutDiscountType" AS ENUM ('MANUAL_CODE', 'AUTOMATIC');

CREATE TABLE "ExpressCheckoutIntent" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "customerProfileId" TEXT,
  "sessionTokenHash" TEXT,
  "status" "ExpressCheckoutIntentStatus" NOT NULL DEFAULT 'CREATED',
  "phoneSnapshot" TEXT,
  "cartToken" TEXT,
  "shopifyCartId" TEXT,
  "cartSnapshot" JSONB,
  "subtotalAmountPaise" INTEGER NOT NULL DEFAULT 0,
  "discountAmountPaise" INTEGER NOT NULL DEFAULT 0,
  "shippingAmountPaise" INTEGER NOT NULL DEFAULT 0,
  "codFeeAmountPaise" INTEGER NOT NULL DEFAULT 0,
  "totalAmountPaise" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "selectedPaymentMethod" "ExpressCheckoutPaymentMethod",
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpressCheckoutIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpressCheckoutAddressSnapshot" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "customerProfileId" TEXT,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "address1" TEXT NOT NULL,
  "address2" TEXT,
  "city" TEXT NOT NULL,
  "province" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'India',
  "zip" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpressCheckoutAddressSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpressCheckoutDiscount" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "type" "ExpressCheckoutDiscountType" NOT NULL,
  "code" TEXT,
  "title" TEXT,
  "discountAmountPaise" INTEGER NOT NULL DEFAULT 0,
  "rawShopifyPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpressCheckoutDiscount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpressCheckoutPayment" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "method" "ExpressCheckoutPaymentMethod" NOT NULL,
  "status" "ExpressCheckoutPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amountPaise" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "razorpayOrderId" TEXT,
  "razorpayPaymentId" TEXT,
  "razorpaySignatureHash" TEXT,
  "failureReason" TEXT,
  "rawGatewayPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpressCheckoutPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpressCheckoutOrderLink" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "draftOrderId" TEXT,
  "draftOrderName" TEXT,
  "shopifyOrderId" TEXT,
  "shopifyOrderName" TEXT,
  "financialStatus" TEXT,
  "fulfillmentStatus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpressCheckoutOrderLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExpressCheckoutIntent_shopId_id_idx" ON "ExpressCheckoutIntent"("shopId", "id");
CREATE INDEX "ExpressCheckoutIntent_shopId_customerProfileId_idx" ON "ExpressCheckoutIntent"("shopId", "customerProfileId");
CREATE INDEX "ExpressCheckoutIntent_shopId_status_idx" ON "ExpressCheckoutIntent"("shopId", "status");
CREATE INDEX "ExpressCheckoutIntent_shopId_sessionTokenHash_idx" ON "ExpressCheckoutIntent"("shopId", "sessionTokenHash");
CREATE INDEX "ExpressCheckoutIntent_shopId_cartToken_idx" ON "ExpressCheckoutIntent"("shopId", "cartToken");
CREATE INDEX "ExpressCheckoutIntent_shopId_shopifyCartId_idx" ON "ExpressCheckoutIntent"("shopId", "shopifyCartId");

CREATE INDEX "ExpressCheckoutAddressSnapshot_shopId_id_idx" ON "ExpressCheckoutAddressSnapshot"("shopId", "id");
CREATE INDEX "ExpressCheckoutAddressSnapshot_shopId_intentId_idx" ON "ExpressCheckoutAddressSnapshot"("shopId", "intentId");
CREATE INDEX "ExpressCheckoutAddressSnapshot_shopId_customerProfileId_idx" ON "ExpressCheckoutAddressSnapshot"("shopId", "customerProfileId");

CREATE INDEX "ExpressCheckoutDiscount_shopId_id_idx" ON "ExpressCheckoutDiscount"("shopId", "id");
CREATE INDEX "ExpressCheckoutDiscount_shopId_intentId_idx" ON "ExpressCheckoutDiscount"("shopId", "intentId");
CREATE INDEX "ExpressCheckoutDiscount_shopId_code_idx" ON "ExpressCheckoutDiscount"("shopId", "code");

CREATE INDEX "ExpressCheckoutPayment_shopId_id_idx" ON "ExpressCheckoutPayment"("shopId", "id");
CREATE INDEX "ExpressCheckoutPayment_shopId_intentId_idx" ON "ExpressCheckoutPayment"("shopId", "intentId");
CREATE INDEX "ExpressCheckoutPayment_shopId_status_idx" ON "ExpressCheckoutPayment"("shopId", "status");
CREATE UNIQUE INDEX "ExpressCheckoutPayment_shopId_razorpayOrderId_key" ON "ExpressCheckoutPayment"("shopId", "razorpayOrderId");
CREATE UNIQUE INDEX "ExpressCheckoutPayment_shopId_razorpayPaymentId_key" ON "ExpressCheckoutPayment"("shopId", "razorpayPaymentId");

CREATE UNIQUE INDEX "ExpressCheckoutOrderLink_shopId_intentId_key" ON "ExpressCheckoutOrderLink"("shopId", "intentId");
CREATE INDEX "ExpressCheckoutOrderLink_shopId_id_idx" ON "ExpressCheckoutOrderLink"("shopId", "id");
CREATE INDEX "ExpressCheckoutOrderLink_shopId_intentId_idx" ON "ExpressCheckoutOrderLink"("shopId", "intentId");
CREATE INDEX "ExpressCheckoutOrderLink_shopId_shopifyOrderId_idx" ON "ExpressCheckoutOrderLink"("shopId", "shopifyOrderId");

ALTER TABLE "ExpressCheckoutAddressSnapshot" ADD CONSTRAINT "ExpressCheckoutAddressSnapshot_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "ExpressCheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpressCheckoutDiscount" ADD CONSTRAINT "ExpressCheckoutDiscount_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "ExpressCheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpressCheckoutPayment" ADD CONSTRAINT "ExpressCheckoutPayment_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "ExpressCheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpressCheckoutOrderLink" ADD CONSTRAINT "ExpressCheckoutOrderLink_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "ExpressCheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
