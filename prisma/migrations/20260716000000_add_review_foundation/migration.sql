-- CreateEnum
CREATE TYPE "MegaskaOrderDeliverySource" AS ENUM ('SHOPIFY_FULFILLMENT', 'COURIER_SHIPMENT', 'INTERNAL_STATUS', 'MANUAL', 'MIGRATED');

-- CreateEnum
CREATE TYPE "ReviewRequestStatus" AS ENUM ('PENDING_ELIGIBILITY', 'ELIGIBLE', 'SCHEDULED', 'SENT', 'REMINDER_SENT', 'COMPLETED', 'BLOCKED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ReviewRequestBlockReason" AS ENUM ('ORDER_NOT_DELIVERED', 'CUSTOMER_NOT_RESOLVED', 'PRODUCT_NOT_RESOLVED', 'CANCELED_ORDER', 'REFUNDED_ORDER', 'CANCELLATION_REQUEST', 'EXCHANGE_REQUEST', 'ISSUE_REQUEST', 'REFUND_REQUEST', 'PROTECTION_WINDOW', 'ALREADY_REVIEWED', 'REVIEWS_DISABLED', 'CUSTOMER_UNREACHABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductReviewStatus" AS ENUM ('DRAFT', 'PENDING_MODERATION', 'PUBLISHED', 'REJECTED', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "ProductReviewSource" AS ENUM ('VERIFIED_PURCHASE', 'MANUAL_IMPORT', 'MERCHANT_CREATED');

-- CreateEnum
CREATE TYPE "ProductReviewMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "MegaskaOrder" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliverySource" "MegaskaOrderDeliverySource";

-- CreateTable
CREATE TABLE "ReviewSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "reviewsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "automaticRequestsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "requestDelayDays" INTEGER NOT NULL DEFAULT 7,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderDelayDays" INTEGER NOT NULL DEFAULT 7,
    "maxReminderCount" INTEGER NOT NULL DEFAULT 1,
    "minimumRating" INTEGER NOT NULL DEFAULT 1,
    "maximumRating" INTEGER NOT NULL DEFAULT 5,
    "requireVerifiedPurchase" BOOLEAN NOT NULL DEFAULT true,
    "moderationRequired" BOOLEAN NOT NULL DEFAULT true,
    "allowReviewEditing" BOOLEAN NOT NULL DEFAULT true,
    "allowReviewDeletion" BOOLEAN NOT NULL DEFAULT true,
    "allowMedia" BOOLEAN NOT NULL DEFAULT true,
    "maxMediaCount" INTEGER NOT NULL DEFAULT 5,
    "exchangeProtectionDays" INTEGER,
    "issueProtectionDays" INTEGER,
    "cancellationBlocksReview" BOOLEAN NOT NULL DEFAULT true,
    "exchangeBlocksReview" BOOLEAN NOT NULL DEFAULT true,
    "issueBlocksReview" BOOLEAN NOT NULL DEFAULT true,
    "refundBlocksReview" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "megaskaOrderId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT,
    "shopifyLineItemId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "productTitleSnapshot" TEXT NOT NULL,
    "variantTitleSnapshot" TEXT,
    "productHandleSnapshot" TEXT,
    "productImageUrlSnapshot" TEXT,
    "orderCreatedAt" TIMESTAMP(3),
    "deliveredAtSnapshot" TIMESTAMP(3),
    "status" "ReviewRequestStatus" NOT NULL DEFAULT 'PENDING_ELIGIBILITY',
    "blockReason" "ReviewRequestBlockReason",
    "blockDetail" TEXT,
    "eligibleAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "sendAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReview" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerProfileId" TEXT,
    "reviewRequestId" TEXT,
    "megaskaOrderId" TEXT,
    "shopifyOrderId" TEXT,
    "shopifyLineItemId" TEXT,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "source" "ProductReviewSource" NOT NULL DEFAULT 'VERIFIED_PURCHASE',
    "status" "ProductReviewStatus" NOT NULL DEFAULT 'PENDING_MODERATION',
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "customerDisplayName" TEXT NOT NULL,
    "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
    "productTitleSnapshot" TEXT NOT NULL,
    "variantTitleSnapshot" TEXT,
    "productHandleSnapshot" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "moderationNote" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReviewMedia" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productReviewId" TEXT NOT NULL,
    "mediaType" "ProductReviewMediaType" NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT,
    "thumbnailUrl" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" INTEGER,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "rejectedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReviewMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReviewMerchantReply" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productReviewId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "repliedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReviewMerchantReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReviewAggregate" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "publishedCount" INTEGER NOT NULL DEFAULT 0,
    "ratingSum" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "rating1Count" INTEGER NOT NULL DEFAULT 0,
    "rating2Count" INTEGER NOT NULL DEFAULT 0,
    "rating3Count" INTEGER NOT NULL DEFAULT 0,
    "rating4Count" INTEGER NOT NULL DEFAULT 0,
    "rating5Count" INTEGER NOT NULL DEFAULT 0,
    "lastPublishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReviewAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSettings_shopId_key" ON "ReviewSettings"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_tokenHash_key" ON "ReviewRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "ReviewRequest_shopId_status_scheduledAt_idx" ON "ReviewRequest"("shopId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ReviewRequest_customerProfileId_status_idx" ON "ReviewRequest"("customerProfileId", "status");

-- CreateIndex
CREATE INDEX "ReviewRequest_megaskaOrderId_idx" ON "ReviewRequest"("megaskaOrderId");

-- CreateIndex
CREATE INDEX "ReviewRequest_shopId_shopifyProductId_idx" ON "ReviewRequest"("shopId", "shopifyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_shopId_shopifyOrderId_shopifyLineItemId_key" ON "ReviewRequest"("shopId", "shopifyOrderId", "shopifyLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReview_reviewRequestId_key" ON "ProductReview"("reviewRequestId");

-- CreateIndex
CREATE INDEX "ProductReview_shopId_shopifyProductId_status_publishedAt_idx" ON "ProductReview"("shopId", "shopifyProductId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "ProductReview_shopId_customerProfileId_submittedAt_idx" ON "ProductReview"("shopId", "customerProfileId", "submittedAt");

-- CreateIndex
CREATE INDEX "ProductReview_megaskaOrderId_idx" ON "ProductReview"("megaskaOrderId");

-- CreateIndex
CREATE INDEX "ProductReview_shopId_status_submittedAt_idx" ON "ProductReview"("shopId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "ProductReviewMedia_productReviewId_sortOrder_idx" ON "ProductReviewMedia"("productReviewId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductReviewMedia_shopId_approved_idx" ON "ProductReviewMedia"("shopId", "approved");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReviewMedia_storageProvider_storageKey_key" ON "ProductReviewMedia"("storageProvider", "storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReviewMerchantReply_productReviewId_key" ON "ProductReviewMerchantReply"("productReviewId");

-- CreateIndex
CREATE INDEX "ProductReviewMerchantReply_shopId_publishedAt_idx" ON "ProductReviewMerchantReply"("shopId", "publishedAt");

-- CreateIndex
CREATE INDEX "ProductReviewAggregate_shopId_averageRating_idx" ON "ProductReviewAggregate"("shopId", "averageRating");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReviewAggregate_shopId_shopifyProductId_key" ON "ProductReviewAggregate"("shopId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "MegaskaOrder_shopId_deliveredAt_idx" ON "MegaskaOrder"("shopId", "deliveredAt");

-- AddForeignKey
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_megaskaOrderId_fkey" FOREIGN KEY ("megaskaOrderId") REFERENCES "MegaskaOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_reviewRequestId_fkey" FOREIGN KEY ("reviewRequestId") REFERENCES "ReviewRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_megaskaOrderId_fkey" FOREIGN KEY ("megaskaOrderId") REFERENCES "MegaskaOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReviewMedia" ADD CONSTRAINT "ProductReviewMedia_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReviewMedia" ADD CONSTRAINT "ProductReviewMedia_productReviewId_fkey" FOREIGN KEY ("productReviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReviewMerchantReply" ADD CONSTRAINT "ProductReviewMerchantReply_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReviewMerchantReply" ADD CONSTRAINT "ProductReviewMerchantReply_productReviewId_fkey" FOREIGN KEY ("productReviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReviewAggregate" ADD CONSTRAINT "ProductReviewAggregate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Application invariants Prisma cannot express.
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_rating_range_check" CHECK ("rating" >= 1 AND "rating" <= 5);
ALTER TABLE "ProductReviewAggregate" ADD CONSTRAINT "ProductReviewAggregate_nonnegative_check" CHECK (
  "publishedCount" >= 0 AND "ratingSum" >= 0 AND "rating1Count" >= 0 AND "rating2Count" >= 0 AND
  "rating3Count" >= 0 AND "rating4Count" >= 0 AND "rating5Count" >= 0
);
ALTER TABLE "ProductReviewAggregate" ADD CONSTRAINT "ProductReviewAggregate_average_range_check" CHECK ("averageRating" >= 0 AND "averageRating" <= 5);
