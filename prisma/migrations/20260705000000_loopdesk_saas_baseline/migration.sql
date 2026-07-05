-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('EXCHANGE', 'REFUND', 'CANCELLATION', 'ISSUE');

-- CreateEnum
CREATE TYPE "ExchangeRequestStatus" AS ENUM ('OPEN', 'AWAITING_PAYMENT', 'PAYMENT_RECEIVED', 'PICKUP_PENDING', 'PICKUP_SCHEDULED', 'PICKUP_COMPLETED', 'ITEM_RECEIVED', 'APPROVED', 'RETURN_RECEIVED', 'REJECTED', 'REPLACEMENT_PROCESSING', 'REPLACEMENT_SHIPPED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('REVERSE_PICKUP_FEE');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CodAdvanceStatus" AS ENUM ('CREATED', 'PAYMENT_PENDING', 'ADVANCE_PAID', 'ORDER_LINKED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundSource" AS ENUM ('ORDER_ACTION_REQUEST', 'SHOPIFY_REFUND', 'ISSUE_REQUEST', 'CANCELLATION_REQUEST', 'RTO_EVENT', 'ADMIN_EXCEPTION', 'ORDER_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('COD', 'PREPAID', 'NO_REFUND');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'MANUAL_PENDING', 'NOT_REQUIRED', 'DETAILS_PENDING', 'DETAILS_SUBMITTED', 'REVIEW_PENDING', 'APPROVED', 'REJECTED', 'PAYOUT_PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundPayoutRail" AS ENUM ('UPI', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "RefundPayoutStatus" AS ENUM ('CREATED', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundActorType" AS ENUM ('SYSTEM', 'ADMIN', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ExchangePaymentInvoiceStatus" AS ENUM ('GENERATED', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentDirection" AS ENUM ('REVERSE_PICKUP', 'FORWARD_REPLACEMENT');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "MegaskaOrderStatus" AS ENUM ('ORDER_CONFIRMED', 'PROCESSING', 'PACKED', 'READY_FOR_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RTO_INITIATED', 'RTO_DELIVERED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CourierProvider" AS ENUM ('DELHIVERY', 'DTDC', 'ATS', 'OTHER');

-- CreateEnum
CREATE TYPE "WalletDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('COD_REFUND_CREDIT', 'MANUAL_CREDIT', 'MANUAL_DEBIT', 'ADJUSTMENT', 'GOODWILL_CREDIT', 'CHECKOUT_REDEMPTION');

-- CreateEnum
CREATE TYPE "WalletSourceType" AS ENUM ('ISSUE_REQUEST', 'ADMIN_MANUAL', 'WALLET_RESERVATION', 'REFUND_REQUEST', 'CHECKOUT_INTENT', 'SHOPIFY_ORDER');

-- CreateEnum
CREATE TYPE "WalletActorType" AS ENUM ('SYSTEM', 'ADMIN');

-- CreateEnum
CREATE TYPE "WalletReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WalletReservationSourceFlow" AS ENUM ('CHECKOUT', 'BUY_NOW');

-- CreateEnum
CREATE TYPE "GstDocumentType" AS ENUM ('TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "GstDocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED', 'VOID', 'FAILED');

-- CreateEnum
CREATE TYPE "GstNumberingStrategy" AS ENUM ('FINANCIAL_YEAR_SEQUENCE', 'CALENDAR_YEAR_SEQUENCE', 'MONTHLY_SEQUENCE', 'MANUAL');

-- CreateEnum
CREATE TYPE "GstSupplyType" AS ENUM ('B2B', 'B2C', 'EXPORT', 'SEZ_WITH_PAYMENT', 'SEZ_WITHOUT_PAYMENT', 'DEEMED_EXPORT');

-- CreateEnum
CREATE TYPE "ExpressCheckoutIntentStatus" AS ENUM ('CREATED', 'CUSTOMER_AUTHENTICATED', 'CART_SNAPSHOT_LOCKED', 'ADDRESS_CAPTURED', 'DISCOUNT_APPLIED', 'PAYMENT_METHOD_SELECTED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'ORDER_CREATING', 'ORDER_CREATED', 'FAILED', 'EXPIRED', 'CANCELLED', 'INITIATED', 'SESSION_VERIFIED', 'ADDRESS_COMPLETED', 'DELIVERY_VALIDATED', 'COUPON_APPLIED', 'PAYMENT_SELECTED', 'DRAFT_ORDER_CREATED', 'PAYMENT_SUCCESS', 'ORDER_COMPLETED', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ExpressCheckoutPaymentMethod" AS ENUM ('PREPAID', 'COD');

-- CreateEnum
CREATE TYPE "ExpressCheckoutPaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ExpressCheckoutDiscountType" AS ENUM ('MANUAL_CODE', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "CheckoutRecoveryType" AS ENUM ('CHECKOUT_ABANDONMENT', 'PAYMENT_ABANDONMENT');

-- CreateEnum
CREATE TYPE "CheckoutRecoveryTokenStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "phoneE164" TEXT,
    "fullName" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "stateProvince" TEXT,
    "postalCode" TEXT,
    "countryRegion" TEXT,
    "shopifyCustomerId" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "profileCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "accessToken" TEXT,
    "storefrontAccessToken" TEXT,
    "scopes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" TIMESTAMP(3),
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "myshopifyDomain" TEXT,
    "primaryDomain" TEXT,
    "shopName" TEXT,
    "accessTokenEncrypted" TEXT,
    "storefrontTokenEncrypted" TEXT,
    "appProxyPrefix" TEXT,
    "appProxySubpath" TEXT,
    "appProxyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "installationStatus" TEXT NOT NULL DEFAULT 'DEV',
    "checkoutEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tokenExpiresAt" TIMESTAMP(3),
    "tokenRotationRequiredAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OTPChallenge" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSid" TEXT,
    "status" TEXT NOT NULL,
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerProfileId" TEXT,

    CONSTRAINT "OTPChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderActionRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "requestType" "RequestType" NOT NULL DEFAULT 'EXCHANGE',
    "customerProfileId" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "shopifyOrderId" TEXT,
    "orderNumber" TEXT NOT NULL,
    "status" "ExchangeRequestStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "customerNote" TEXT,
    "adminNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerNameSnapshot" TEXT,
    "customerPhoneSnapshot" TEXT,
    "customerEmailSnapshot" TEXT,
    "orderAmountSnapshot" TEXT,
    "deliveryDateSnapshot" TIMESTAMP(3),
    "eligibilityDecision" TEXT,
    "eligibilityReason" TEXT,
    "megaskaOrderId" TEXT,

    CONSTRAINT "OrderActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderActionItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "currentSize" TEXT,
    "requestedSize" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "isClearance" BOOLEAN NOT NULL DEFAULT false,
    "isExcludedCategory" BOOLEAN NOT NULL DEFAULT false,
    "eligibilitySnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestPayment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL DEFAULT 'REVERSE_PICKUP_FEE',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'NOT_CREATED',
    "paymentLinkId" TEXT,
    "paymentLinkUrl" TEXT,
    "providerReferenceId" TEXT,
    "paymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodAdvanceSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fixedAdvanceAmountPaise" INTEGER NOT NULL DEFAULT 12000,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "minOrderAmountPaise" INTEGER,
    "maxOrderAmountPaise" INTEGER,
    "policyText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodAdvanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodAdvanceIntent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerProfileId" TEXT,
    "cartReference" TEXT,
    "checkoutReference" TEXT,
    "shopifyOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "orderAmountPaise" INTEGER NOT NULL,
    "advanceAmountPaise" INTEGER NOT NULL,
    "codBalanceAmountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "CodAdvanceStatus" NOT NULL DEFAULT 'CREATED',
    "razorpayPaymentLinkId" TEXT,
    "razorpayPaymentLinkUrl" TEXT,
    "razorpayPaymentId" TEXT,
    "providerReferenceId" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodAdvanceIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentTracking" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "direction" "ShipmentDirection" NOT NULL,
    "carrier" TEXT,
    "awb" TEXT,
    "trackingUrl" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "pickupAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentTracking_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "WalletAccount" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "currentBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "walletAccountId" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "direction" "WalletDirection" NOT NULL,
    "transactionType" "WalletTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "sourceType" "WalletSourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceReference" TEXT,
    "orderNumber" TEXT,
    "reason" TEXT,
    "adminNote" TEXT,
    "createdByType" "WalletActorType" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletReservation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "walletAccountId" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "reservedAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "WalletReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "discountCode" TEXT,
    "shopifyDiscountId" TEXT,
    "sourceFlow" "WalletReservationSourceFlow" NOT NULL DEFAULT 'CHECKOUT',
    "cartReference" TEXT,
    "checkoutReference" TEXT,
    "sessionReference" TEXT,
    "orderNumber" TEXT,
    "shopifyOrderId" TEXT,
    "releaseReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "source" "RefundSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "method" "RefundMethod" NOT NULL DEFAULT 'COD',
    "status" "RefundStatus" NOT NULL DEFAULT 'DETAILS_PENDING',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "amount" INTEGER NOT NULL,
    "customerProfileId" TEXT,
    "orderActionRequestId" TEXT,
    "walletTransactionId" TEXT,
    "shopifyOrderId" TEXT,
    "shopifyRefundId" TEXT,
    "reason" TEXT,
    "customerNote" TEXT,
    "adminNote" TEXT,
    "metadata" JSONB,
    "detailsSubmittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundPayoutDetails" (
    "id" TEXT NOT NULL,
    "refundRequestId" TEXT NOT NULL,
    "rail" "RefundPayoutRail" NOT NULL,
    "accountHolderName" TEXT,
    "bankAccountMasked" TEXT,
    "bankAccountEnc" TEXT,
    "bankIfsc" TEXT,
    "upiIdMasked" TEXT,
    "upiIdEnc" TEXT,
    "phoneMasked" TEXT,
    "phoneEnc" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundPayoutDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundPayout" (
    "id" TEXT NOT NULL,
    "refundRequestId" TEXT NOT NULL,
    "status" "RefundPayoutStatus" NOT NULL DEFAULT 'CREATED',
    "provider" TEXT,
    "providerReferenceId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "initiatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundEvent" (
    "id" TEXT NOT NULL,
    "refundRequestId" TEXT NOT NULL,
    "actorType" "RefundActorType" NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "fromStatus" "RefundStatus",
    "toStatus" "RefundStatus",
    "message" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "gstin" TEXT NOT NULL,
    "pan" TEXT,
    "stateCode" TEXT NOT NULL,
    "invoicePrefix" TEXT NOT NULL,
    "creditNotePrefix" TEXT NOT NULL,
    "debitNotePrefix" TEXT NOT NULL,
    "invoiceNumberStrategy" "GstNumberingStrategy" NOT NULL,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'INR',
    "priceIncludesTax" BOOLEAN NOT NULL DEFAULT true,
    "einvoiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstCounter" (
    "id" TEXT NOT NULL,
    "gstSettingsId" TEXT NOT NULL,
    "documentType" "GstDocumentType" NOT NULL,
    "financialYear" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstDocument" (
    "id" TEXT NOT NULL,
    "documentType" "GstDocumentType" NOT NULL,
    "status" "GstDocumentStatus" NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "gstSettingsId" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "sourceOrderId" TEXT,
    "sourceOrderNumber" TEXT,
    "sourceReference" TEXT,
    "customerProfileId" TEXT,
    "originalDocumentId" TEXT,
    "supplyType" "GstSupplyType" NOT NULL,
    "placeOfSupplyStateCode" TEXT NOT NULL,
    "isInterstate" BOOLEAN NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "taxableAmount" DECIMAL(14,2) NOT NULL,
    "cgstAmount" DECIMAL(14,2) NOT NULL,
    "sgstAmount" DECIMAL(14,2) NOT NULL,
    "igstAmount" DECIMAL(14,2) NOT NULL,
    "cessAmount" DECIMAL(14,2) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "pdfFileUrl" TEXT,
    "jsonSnapshot" JSONB NOT NULL,
    "metadata" JSONB,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstDocumentLine" (
    "id" TEXT NOT NULL,
    "gstDocumentId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "hsnOrSac" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "cgstAmount" DECIMAL(14,2) NOT NULL,
    "sgstAmount" DECIMAL(14,2) NOT NULL,
    "igstAmount" DECIMAL(14,2) NOT NULL,
    "cessAmount" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstParty" (
    "id" TEXT NOT NULL,
    "gstin" TEXT,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "customerProfileId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "stateCode" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'IN',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstExport" (
    "id" TEXT NOT NULL,
    "gstSettingsId" TEXT NOT NULL,
    "exportType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "storageUrl" TEXT,
    "checksum" TEXT,
    "filters" JSONB,
    "generatedByType" TEXT,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstExportItem" (
    "id" TEXT NOT NULL,
    "gstExportId" TEXT NOT NULL,
    "gstDocumentId" TEXT,
    "rowNumber" INTEGER NOT NULL,
    "documentType" "GstDocumentType",
    "documentNumber" TEXT,
    "documentDate" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstExportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstReconciliationRun" (
    "id" TEXT NOT NULL,
    "gstSettingsId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchedCount" INTEGER NOT NULL DEFAULT 0,
    "missingInBooksCount" INTEGER NOT NULL DEFAULT 0,
    "missingInPortalCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstAuditLog" (
    "id" TEXT NOT NULL,
    "gstSettingsId" TEXT,
    "gstDocumentId" TEXT,
    "gstPartyId" TEXT,
    "gstExportId" TEXT,
    "reconciliationRunId" TEXT,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "previousState" JSONB,
    "nextState" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GstAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstLegacyDocument" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "legacyDocumentId" TEXT NOT NULL,
    "legacyDocumentNumber" TEXT,
    "documentType" "GstDocumentType",
    "documentStatus" "GstDocumentStatus",
    "gstDocumentId" TEXT,
    "gstPartyId" TEXT,
    "payload" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstLegacyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstHsnCode" (
    "id" TEXT NOT NULL,
    "hsnCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstHsnCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstTaxSlab" (
    "id" TEXT NOT NULL,
    "slabCode" TEXT NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstTaxSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstHsnSlabMap" (
    "id" TEXT NOT NULL,
    "hsnId" TEXT NOT NULL,
    "slabId" TEXT NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstHsnSlabMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstProductTaxMap" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "hsnId" TEXT NOT NULL,
    "slabId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "lastValidatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstProductTaxMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstSkuTaxMap" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "sku" TEXT,
    "styleCode" TEXT,
    "hsnCode" TEXT NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'BULK_CSV',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstSkuTaxMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstOrderImport" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "gstSettingsId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL,
    "orderCreatedAt" TIMESTAMP(3) NOT NULL,
    "orderCurrency" TEXT NOT NULL,
    "orderSubtotal" DECIMAL(14,2) NOT NULL,
    "orderTaxTotal" DECIMAL(14,2) NOT NULL,
    "orderGrandTotal" DECIMAL(14,2) NOT NULL,
    "shippingStateCode" TEXT,
    "billingStateCode" TEXT,
    "importStatus" TEXT NOT NULL,
    "eligibilityStatus" TEXT NOT NULL,
    "readinessErrors" JSONB NOT NULL DEFAULT '[]',
    "snapshot" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstOrderImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstOrderImportLine" (
    "id" TEXT NOT NULL,
    "gstOrderImportId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "shopifyLineItemId" TEXT,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(14,2) NOT NULL,
    "mappedHsnCode" TEXT,
    "mappedTaxRate" DECIMAL(5,2),
    "mappedCessRate" DECIMAL(5,2),
    "mappingStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstOrderImportLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstInvoiceTemplate" (
    "id" TEXT NOT NULL,
    "gstSettingsId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "isDefault" BOOLEAN NOT NULL,
    "headerText" TEXT,
    "footerText" TEXT,
    "declarationText" TEXT,
    "notesText" TEXT,
    "logoFileUrl" TEXT,
    "themeConfig" JSONB,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstInvoiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstReportRun" (
    "id" TEXT NOT NULL,
    "gstSettingsId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "filters" JSONB,
    "fileUrl" TEXT,
    "checksum" TEXT,
    "rowCount" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangePaymentInvoice" (
    "id" TEXT NOT NULL,
    "requestPaymentId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "invoiceStatus" "ExchangePaymentInvoiceStatus" NOT NULL DEFAULT 'GENERATED',
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "orderNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "taxableAmountPaise" INTEGER NOT NULL,
    "gstRatePercent" DOUBLE PRECISION NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "pdfUrl" TEXT,
    "htmlSnapshot" TEXT,
    "textSnapshot" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangePaymentInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "CheckoutRecoveryToken" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "checkoutIntentId" TEXT NOT NULL,
    "customerProfileId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "recoveryType" "CheckoutRecoveryType" NOT NULL,
    "status" "CheckoutRecoveryTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "clickedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "CheckoutRecoveryToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "ShopModuleConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopModuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopProxyRoute" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "proxyPrefix" TEXT NOT NULL,
    "proxySubpath" TEXT NOT NULL,
    "targetModule" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopProxyRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopInstallationEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "scopes" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopInstallationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerProfile_shopId_idx" ON "CustomerProfile"("shopId");

-- CreateIndex
CREATE INDEX "CustomerProfile_shopId_phoneE164_idx" ON "CustomerProfile"("shopId", "phoneE164");

-- CreateIndex
CREATE INDEX "CustomerProfile_shopId_email_idx" ON "CustomerProfile"("shopId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_shopId_shopifyCustomerId_key" ON "CustomerProfile"("shopId", "shopifyCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_myshopifyDomain_key" ON "Shop"("myshopifyDomain");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_sessionTokenHash_key" ON "AuthSession"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "OTPChallenge_shopId_idx" ON "OTPChallenge"("shopId");

-- CreateIndex
CREATE INDEX "OTPChallenge_shopId_phoneE164_idx" ON "OTPChallenge"("shopId", "phoneE164");

-- CreateIndex
CREATE INDEX "OTPChallenge_shopId_phoneE164_status_createdAt_idx" ON "OTPChallenge"("shopId", "phoneE164", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OrderActionRequest_customerProfileId_idx" ON "OrderActionRequest"("customerProfileId");

-- CreateIndex
CREATE INDEX "OrderActionRequest_status_idx" ON "OrderActionRequest"("status");

-- CreateIndex
CREATE INDEX "OrderActionRequest_orderNumber_idx" ON "OrderActionRequest"("orderNumber");

-- CreateIndex
CREATE INDEX "OrderActionRequest_shopId_idx" ON "OrderActionRequest"("shopId");

-- CreateIndex
CREATE INDEX "OrderActionRequest_megaskaOrderId_idx" ON "OrderActionRequest"("megaskaOrderId");

-- CreateIndex
CREATE INDEX "OrderActionItem_requestId_idx" ON "OrderActionItem"("requestId");

-- CreateIndex
CREATE INDEX "RequestPayment_requestId_idx" ON "RequestPayment"("requestId");

-- CreateIndex
CREATE INDEX "RequestPayment_status_idx" ON "RequestPayment"("status");

-- CreateIndex
CREATE INDEX "RequestPayment_paymentLinkId_idx" ON "RequestPayment"("paymentLinkId");

-- CreateIndex
CREATE INDEX "CodAdvanceSettings_shopId_idx" ON "CodAdvanceSettings"("shopId");

-- CreateIndex
CREATE INDEX "CodAdvanceIntent_shopId_idx" ON "CodAdvanceIntent"("shopId");

-- CreateIndex
CREATE INDEX "CodAdvanceIntent_status_idx" ON "CodAdvanceIntent"("status");

-- CreateIndex
CREATE INDEX "CodAdvanceIntent_razorpayPaymentLinkId_idx" ON "CodAdvanceIntent"("razorpayPaymentLinkId");

-- CreateIndex
CREATE INDEX "CodAdvanceIntent_shopifyOrderId_idx" ON "CodAdvanceIntent"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "CodAdvanceIntent_customerProfileId_createdAt_idx" ON "CodAdvanceIntent"("customerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "ShipmentTracking_requestId_idx" ON "ShipmentTracking"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentTracking_requestId_direction_key" ON "ShipmentTracking"("requestId", "direction");

-- CreateIndex
CREATE INDEX "MegaskaOrder_customerProfileId_createdAt_idx" ON "MegaskaOrder"("customerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "MegaskaOrder_shopifyOrderId_idx" ON "MegaskaOrder"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "MegaskaOrder_status_idx" ON "MegaskaOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MegaskaOrder_shopId_shopifyOrderName_key" ON "MegaskaOrder"("shopId", "shopifyOrderName");

-- CreateIndex
CREATE INDEX "OrderShipment_orderId_createdAt_idx" ON "OrderShipment"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderShipment_provider_providerReference_idx" ON "OrderShipment"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "OrderShipment_awb_idx" ON "OrderShipment"("awb");

-- CreateIndex
CREATE INDEX "OrderShipmentEvent_shipmentId_occurredAt_idx" ON "OrderShipmentEvent"("shipmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "WalletAccount_shopId_idx" ON "WalletAccount"("shopId");

-- CreateIndex
CREATE INDEX "WalletAccount_customerProfileId_idx" ON "WalletAccount"("customerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccount_shopId_customerProfileId_currency_key" ON "WalletAccount"("shopId", "customerProfileId", "currency");

-- CreateIndex
CREATE INDEX "WalletTransaction_customerProfileId_createdAt_idx" ON "WalletTransaction"("customerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletAccountId_createdAt_idx" ON "WalletTransaction"("walletAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_sourceType_sourceId_idx" ON "WalletTransaction"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "WalletTransaction_shopId_customerProfileId_createdAt_idx" ON "WalletTransaction"("shopId", "customerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_shopId_sourceType_sourceId_idx" ON "WalletTransaction"("shopId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_sourceType_sourceId_transactionType_key" ON "WalletTransaction"("sourceType", "sourceId", "transactionType");

-- CreateIndex
CREATE INDEX "WalletReservation_customerProfileId_status_expiresAt_idx" ON "WalletReservation"("customerProfileId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "WalletReservation_walletAccountId_status_expiresAt_idx" ON "WalletReservation"("walletAccountId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "WalletReservation_discountCode_idx" ON "WalletReservation"("discountCode");

-- CreateIndex
CREATE INDEX "WalletReservation_shopifyOrderId_idx" ON "WalletReservation"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "WalletReservation_shopId_status_expiresAt_idx" ON "WalletReservation"("shopId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "RefundRequest_shopId_status_createdAt_idx" ON "RefundRequest"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RefundRequest_customerProfileId_createdAt_idx" ON "RefundRequest"("customerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "RefundRequest_orderActionRequestId_idx" ON "RefundRequest"("orderActionRequestId");

-- CreateIndex
CREATE INDEX "RefundRequest_walletTransactionId_idx" ON "RefundRequest"("walletTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequest_shopId_source_sourceId_key" ON "RefundRequest"("shopId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundPayoutDetails_refundRequestId_key" ON "RefundPayoutDetails"("refundRequestId");

-- CreateIndex
CREATE INDEX "RefundPayout_refundRequestId_createdAt_idx" ON "RefundPayout"("refundRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "RefundPayout_status_createdAt_idx" ON "RefundPayout"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RefundEvent_refundRequestId_createdAt_idx" ON "RefundEvent"("refundRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GstSettings_gstin_key" ON "GstSettings"("gstin");

-- CreateIndex
CREATE INDEX "GstSettings_shopId_idx" ON "GstSettings"("shopId");

-- CreateIndex
CREATE INDEX "GstCounter_gstSettingsId_documentType_idx" ON "GstCounter"("gstSettingsId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "GstCounter_gstSettingsId_documentType_financialYear_key" ON "GstCounter"("gstSettingsId", "documentType", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "GstDocument_documentNumber_key" ON "GstDocument"("documentNumber");

-- CreateIndex
CREATE INDEX "GstDocument_gstSettingsId_idx" ON "GstDocument"("gstSettingsId");

-- CreateIndex
CREATE INDEX "GstDocument_customerProfileId_idx" ON "GstDocument"("customerProfileId");

-- CreateIndex
CREATE INDEX "GstDocument_sourceOrderId_idx" ON "GstDocument"("sourceOrderId");

-- CreateIndex
CREATE INDEX "GstDocument_sourceOrderNumber_idx" ON "GstDocument"("sourceOrderNumber");

-- CreateIndex
CREATE INDEX "GstDocument_originalDocumentId_idx" ON "GstDocument"("originalDocumentId");

-- CreateIndex
CREATE INDEX "GstDocument_status_documentDate_idx" ON "GstDocument"("status", "documentDate");

-- CreateIndex
CREATE INDEX "GstDocumentLine_gstDocumentId_idx" ON "GstDocumentLine"("gstDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "GstDocumentLine_gstDocumentId_lineNumber_key" ON "GstDocumentLine"("gstDocumentId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GstParty_gstin_key" ON "GstParty"("gstin");

-- CreateIndex
CREATE INDEX "GstParty_customerProfileId_idx" ON "GstParty"("customerProfileId");

-- CreateIndex
CREATE INDEX "GstParty_legalName_idx" ON "GstParty"("legalName");

-- CreateIndex
CREATE INDEX "GstExport_gstSettingsId_periodStart_periodEnd_idx" ON "GstExport"("gstSettingsId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "GstExport_status_createdAt_idx" ON "GstExport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GstExport_gstSettingsId_exportType_periodStart_periodEnd_key" ON "GstExport"("gstSettingsId", "exportType", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "GstExportItem_gstDocumentId_idx" ON "GstExportItem"("gstDocumentId");

-- CreateIndex
CREATE INDEX "GstExportItem_status_idx" ON "GstExportItem"("status");

-- CreateIndex
CREATE INDEX "GstExportItem_documentType_documentDate_idx" ON "GstExportItem"("documentType", "documentDate");

-- CreateIndex
CREATE UNIQUE INDEX "GstExportItem_gstExportId_rowNumber_key" ON "GstExportItem"("gstExportId", "rowNumber");

-- CreateIndex
CREATE INDEX "GstReconciliationRun_gstSettingsId_periodStart_periodEnd_idx" ON "GstReconciliationRun"("gstSettingsId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "GstReconciliationRun_status_startedAt_idx" ON "GstReconciliationRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "GstAuditLog_gstDocumentId_createdAt_idx" ON "GstAuditLog"("gstDocumentId", "createdAt");

-- CreateIndex
CREATE INDEX "GstAuditLog_gstPartyId_createdAt_idx" ON "GstAuditLog"("gstPartyId", "createdAt");

-- CreateIndex
CREATE INDEX "GstAuditLog_gstExportId_createdAt_idx" ON "GstAuditLog"("gstExportId", "createdAt");

-- CreateIndex
CREATE INDEX "GstAuditLog_reconciliationRunId_createdAt_idx" ON "GstAuditLog"("reconciliationRunId", "createdAt");

-- CreateIndex
CREATE INDEX "GstAuditLog_action_createdAt_idx" ON "GstAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "GstLegacyDocument_legacyDocumentNumber_idx" ON "GstLegacyDocument"("legacyDocumentNumber");

-- CreateIndex
CREATE INDEX "GstLegacyDocument_gstDocumentId_idx" ON "GstLegacyDocument"("gstDocumentId");

-- CreateIndex
CREATE INDEX "GstLegacyDocument_gstPartyId_idx" ON "GstLegacyDocument"("gstPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "GstLegacyDocument_sourceSystem_legacyDocumentId_key" ON "GstLegacyDocument"("sourceSystem", "legacyDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "GstHsnCode_hsnCode_key" ON "GstHsnCode"("hsnCode");

-- CreateIndex
CREATE UNIQUE INDEX "GstTaxSlab_slabCode_key" ON "GstTaxSlab"("slabCode");

-- CreateIndex
CREATE INDEX "GstHsnSlabMap_hsnId_idx" ON "GstHsnSlabMap"("hsnId");

-- CreateIndex
CREATE INDEX "GstHsnSlabMap_slabId_idx" ON "GstHsnSlabMap"("slabId");

-- CreateIndex
CREATE INDEX "GstHsnSlabMap_effectiveFrom_effectiveTo_idx" ON "GstHsnSlabMap"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "GstHsnSlabMap_hsnId_slabId_effectiveFrom_effectiveTo_key" ON "GstHsnSlabMap"("hsnId", "slabId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "GstProductTaxMap_shopId_idx" ON "GstProductTaxMap"("shopId");

-- CreateIndex
CREATE INDEX "GstProductTaxMap_shopifyProductId_idx" ON "GstProductTaxMap"("shopifyProductId");

-- CreateIndex
CREATE INDEX "GstProductTaxMap_shopifyVariantId_idx" ON "GstProductTaxMap"("shopifyVariantId");

-- CreateIndex
CREATE INDEX "GstProductTaxMap_status_idx" ON "GstProductTaxMap"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GstProductTaxMap_shopId_shopifyProductId_shopifyVariantId_key" ON "GstProductTaxMap"("shopId", "shopifyProductId", "shopifyVariantId");

-- CreateIndex
CREATE INDEX "GstSkuTaxMap_shopId_sku_idx" ON "GstSkuTaxMap"("shopId", "sku");

-- CreateIndex
CREATE INDEX "GstSkuTaxMap_shopId_styleCode_idx" ON "GstSkuTaxMap"("shopId", "styleCode");

-- CreateIndex
CREATE INDEX "GstSkuTaxMap_status_idx" ON "GstSkuTaxMap"("status");

-- CreateIndex
CREATE INDEX "GstOrderImport_shopId_idx" ON "GstOrderImport"("shopId");

-- CreateIndex
CREATE INDEX "GstOrderImport_gstSettingsId_idx" ON "GstOrderImport"("gstSettingsId");

-- CreateIndex
CREATE INDEX "GstOrderImport_shopifyOrderName_idx" ON "GstOrderImport"("shopifyOrderName");

-- CreateIndex
CREATE INDEX "GstOrderImport_importStatus_eligibilityStatus_idx" ON "GstOrderImport"("importStatus", "eligibilityStatus");

-- CreateIndex
CREATE INDEX "GstOrderImport_orderCreatedAt_idx" ON "GstOrderImport"("orderCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GstOrderImport_shopId_shopifyOrderId_key" ON "GstOrderImport"("shopId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "GstOrderImportLine_gstOrderImportId_idx" ON "GstOrderImportLine"("gstOrderImportId");

-- CreateIndex
CREATE INDEX "GstOrderImportLine_shopifyProductId_idx" ON "GstOrderImportLine"("shopifyProductId");

-- CreateIndex
CREATE INDEX "GstOrderImportLine_shopifyVariantId_idx" ON "GstOrderImportLine"("shopifyVariantId");

-- CreateIndex
CREATE INDEX "GstOrderImportLine_mappingStatus_idx" ON "GstOrderImportLine"("mappingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "GstOrderImportLine_gstOrderImportId_lineNumber_key" ON "GstOrderImportLine"("gstOrderImportId", "lineNumber");

-- CreateIndex
CREATE INDEX "GstInvoiceTemplate_gstSettingsId_isActive_idx" ON "GstInvoiceTemplate"("gstSettingsId", "isActive");

-- CreateIndex
CREATE INDEX "GstInvoiceTemplate_gstSettingsId_isDefault_idx" ON "GstInvoiceTemplate"("gstSettingsId", "isDefault");

-- CreateIndex
CREATE INDEX "GstReportRun_gstSettingsId_reportType_periodStart_periodEnd_idx" ON "GstReportRun"("gstSettingsId", "reportType", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "GstReportRun_status_createdAt_idx" ON "GstReportRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangePaymentInvoice_requestPaymentId_key" ON "ExchangePaymentInvoice"("requestPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangePaymentInvoice_invoiceNumber_key" ON "ExchangePaymentInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "ExchangePaymentInvoice_requestId_idx" ON "ExchangePaymentInvoice"("requestId");

-- CreateIndex
CREATE INDEX "ExpressCheckoutIntent_shopId_id_idx" ON "ExpressCheckoutIntent"("shopId", "id");

-- CreateIndex
CREATE INDEX "ExpressCheckoutIntent_shopId_customerProfileId_idx" ON "ExpressCheckoutIntent"("shopId", "customerProfileId");

-- CreateIndex
CREATE INDEX "ExpressCheckoutIntent_shopId_status_idx" ON "ExpressCheckoutIntent"("shopId", "status");

-- CreateIndex
CREATE INDEX "ExpressCheckoutIntent_shopId_sessionTokenHash_idx" ON "ExpressCheckoutIntent"("shopId", "sessionTokenHash");

-- CreateIndex
CREATE INDEX "ExpressCheckoutIntent_shopId_cartToken_idx" ON "ExpressCheckoutIntent"("shopId", "cartToken");

-- CreateIndex
CREATE INDEX "ExpressCheckoutIntent_shopId_shopifyCartId_idx" ON "ExpressCheckoutIntent"("shopId", "shopifyCartId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutRecoveryToken_tokenHash_key" ON "CheckoutRecoveryToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CheckoutRecoveryToken_shopId_tokenHash_status_idx" ON "CheckoutRecoveryToken"("shopId", "tokenHash", "status");

-- CreateIndex
CREATE INDEX "CheckoutRecoveryToken_shopId_checkoutIntentId_idx" ON "CheckoutRecoveryToken"("shopId", "checkoutIntentId");

-- CreateIndex
CREATE INDEX "ExpressCheckoutAddressSnapshot_shopId_id_idx" ON "ExpressCheckoutAddressSnapshot"("shopId", "id");

-- CreateIndex
CREATE INDEX "ExpressCheckoutAddressSnapshot_shopId_intentId_idx" ON "ExpressCheckoutAddressSnapshot"("shopId", "intentId");

-- CreateIndex
CREATE INDEX "ExpressCheckoutAddressSnapshot_shopId_customerProfileId_idx" ON "ExpressCheckoutAddressSnapshot"("shopId", "customerProfileId");

-- CreateIndex
CREATE INDEX "ExpressCheckoutDiscount_shopId_id_idx" ON "ExpressCheckoutDiscount"("shopId", "id");

-- CreateIndex
CREATE INDEX "ExpressCheckoutDiscount_shopId_intentId_idx" ON "ExpressCheckoutDiscount"("shopId", "intentId");

-- CreateIndex
CREATE INDEX "ExpressCheckoutDiscount_shopId_code_idx" ON "ExpressCheckoutDiscount"("shopId", "code");

-- CreateIndex
CREATE INDEX "ExpressCheckoutPayment_shopId_id_idx" ON "ExpressCheckoutPayment"("shopId", "id");

-- CreateIndex
CREATE INDEX "ExpressCheckoutPayment_shopId_intentId_idx" ON "ExpressCheckoutPayment"("shopId", "intentId");

-- CreateIndex
CREATE INDEX "ExpressCheckoutPayment_shopId_status_idx" ON "ExpressCheckoutPayment"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExpressCheckoutPayment_shopId_razorpayOrderId_key" ON "ExpressCheckoutPayment"("shopId", "razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpressCheckoutPayment_shopId_razorpayPaymentId_key" ON "ExpressCheckoutPayment"("shopId", "razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpressCheckoutOrderLink_intentId_key" ON "ExpressCheckoutOrderLink"("intentId");

-- CreateIndex
CREATE INDEX "ExpressCheckoutOrderLink_shopId_id_idx" ON "ExpressCheckoutOrderLink"("shopId", "id");

-- CreateIndex
CREATE INDEX "ExpressCheckoutOrderLink_shopId_intentId_idx" ON "ExpressCheckoutOrderLink"("shopId", "intentId");

-- CreateIndex
CREATE INDEX "ExpressCheckoutOrderLink_shopId_shopifyOrderId_idx" ON "ExpressCheckoutOrderLink"("shopId", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpressCheckoutOrderLink_shopId_intentId_key" ON "ExpressCheckoutOrderLink"("shopId", "intentId");

-- CreateIndex
CREATE INDEX "ShopModuleConfig_shopId_idx" ON "ShopModuleConfig"("shopId");

-- CreateIndex
CREATE INDEX "ShopModuleConfig_moduleKey_enabled_idx" ON "ShopModuleConfig"("moduleKey", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ShopModuleConfig_shopId_moduleKey_key" ON "ShopModuleConfig"("shopId", "moduleKey");

-- CreateIndex
CREATE INDEX "ShopProxyRoute_shopId_isActive_idx" ON "ShopProxyRoute"("shopId", "isActive");

-- CreateIndex
CREATE INDEX "ShopProxyRoute_targetModule_isActive_idx" ON "ShopProxyRoute"("targetModule", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ShopProxyRoute_shopId_routeKey_key" ON "ShopProxyRoute"("shopId", "routeKey");

-- CreateIndex
CREATE INDEX "ShopInstallationEvent_shopId_createdAt_idx" ON "ShopInstallationEvent"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "ShopInstallationEvent_eventType_createdAt_idx" ON "ShopInstallationEvent"("eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OTPChallenge" ADD CONSTRAINT "OTPChallenge_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OTPChallenge" ADD CONSTRAINT "OTPChallenge_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderActionRequest" ADD CONSTRAINT "OrderActionRequest_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderActionRequest" ADD CONSTRAINT "OrderActionRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderActionRequest" ADD CONSTRAINT "OrderActionRequest_megaskaOrderId_fkey" FOREIGN KEY ("megaskaOrderId") REFERENCES "MegaskaOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderActionItem" ADD CONSTRAINT "OrderActionItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "OrderActionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestPayment" ADD CONSTRAINT "RequestPayment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "OrderActionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodAdvanceSettings" ADD CONSTRAINT "CodAdvanceSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodAdvanceIntent" ADD CONSTRAINT "CodAdvanceIntent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodAdvanceIntent" ADD CONSTRAINT "CodAdvanceIntent_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTracking" ADD CONSTRAINT "ShipmentTracking_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "OrderActionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MegaskaOrder" ADD CONSTRAINT "MegaskaOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MegaskaOrder" ADD CONSTRAINT "MegaskaOrder_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderShipment" ADD CONSTRAINT "OrderShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MegaskaOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderShipmentEvent" ADD CONSTRAINT "OrderShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "OrderShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "WalletAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletReservation" ADD CONSTRAINT "WalletReservation_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "WalletAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletReservation" ADD CONSTRAINT "WalletReservation_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletReservation" ADD CONSTRAINT "WalletReservation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderActionRequestId_fkey" FOREIGN KEY ("orderActionRequestId") REFERENCES "OrderActionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundPayoutDetails" ADD CONSTRAINT "RefundPayoutDetails_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundPayout" ADD CONSTRAINT "RefundPayout_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundEvent" ADD CONSTRAINT "RefundEvent_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstSettings" ADD CONSTRAINT "GstSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstCounter" ADD CONSTRAINT "GstCounter_gstSettingsId_fkey" FOREIGN KEY ("gstSettingsId") REFERENCES "GstSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstDocument" ADD CONSTRAINT "GstDocument_gstSettingsId_fkey" FOREIGN KEY ("gstSettingsId") REFERENCES "GstSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstDocument" ADD CONSTRAINT "GstDocument_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstDocument" ADD CONSTRAINT "GstDocument_originalDocumentId_fkey" FOREIGN KEY ("originalDocumentId") REFERENCES "GstDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstDocumentLine" ADD CONSTRAINT "GstDocumentLine_gstDocumentId_fkey" FOREIGN KEY ("gstDocumentId") REFERENCES "GstDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstParty" ADD CONSTRAINT "GstParty_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstExport" ADD CONSTRAINT "GstExport_gstSettingsId_fkey" FOREIGN KEY ("gstSettingsId") REFERENCES "GstSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstExportItem" ADD CONSTRAINT "GstExportItem_gstExportId_fkey" FOREIGN KEY ("gstExportId") REFERENCES "GstExport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstExportItem" ADD CONSTRAINT "GstExportItem_gstDocumentId_fkey" FOREIGN KEY ("gstDocumentId") REFERENCES "GstDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstReconciliationRun" ADD CONSTRAINT "GstReconciliationRun_gstSettingsId_fkey" FOREIGN KEY ("gstSettingsId") REFERENCES "GstSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstAuditLog" ADD CONSTRAINT "GstAuditLog_gstSettingsId_fkey" FOREIGN KEY ("gstSettingsId") REFERENCES "GstSettings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstAuditLog" ADD CONSTRAINT "GstAuditLog_gstDocumentId_fkey" FOREIGN KEY ("gstDocumentId") REFERENCES "GstDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstAuditLog" ADD CONSTRAINT "GstAuditLog_gstPartyId_fkey" FOREIGN KEY ("gstPartyId") REFERENCES "GstParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstAuditLog" ADD CONSTRAINT "GstAuditLog_gstExportId_fkey" FOREIGN KEY ("gstExportId") REFERENCES "GstExport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstAuditLog" ADD CONSTRAINT "GstAuditLog_reconciliationRunId_fkey" FOREIGN KEY ("reconciliationRunId") REFERENCES "GstReconciliationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstLegacyDocument" ADD CONSTRAINT "GstLegacyDocument_gstDocumentId_fkey" FOREIGN KEY ("gstDocumentId") REFERENCES "GstDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstLegacyDocument" ADD CONSTRAINT "GstLegacyDocument_gstPartyId_fkey" FOREIGN KEY ("gstPartyId") REFERENCES "GstParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstHsnSlabMap" ADD CONSTRAINT "GstHsnSlabMap_hsnId_fkey" FOREIGN KEY ("hsnId") REFERENCES "GstHsnCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstHsnSlabMap" ADD CONSTRAINT "GstHsnSlabMap_slabId_fkey" FOREIGN KEY ("slabId") REFERENCES "GstTaxSlab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstProductTaxMap" ADD CONSTRAINT "GstProductTaxMap_hsnId_fkey" FOREIGN KEY ("hsnId") REFERENCES "GstHsnCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstProductTaxMap" ADD CONSTRAINT "GstProductTaxMap_slabId_fkey" FOREIGN KEY ("slabId") REFERENCES "GstTaxSlab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstProductTaxMap" ADD CONSTRAINT "GstProductTaxMap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstSkuTaxMap" ADD CONSTRAINT "GstSkuTaxMap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstOrderImport" ADD CONSTRAINT "GstOrderImport_gstSettingsId_fkey" FOREIGN KEY ("gstSettingsId") REFERENCES "GstSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstOrderImport" ADD CONSTRAINT "GstOrderImport_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstOrderImportLine" ADD CONSTRAINT "GstOrderImportLine_gstOrderImportId_fkey" FOREIGN KEY ("gstOrderImportId") REFERENCES "GstOrderImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstInvoiceTemplate" ADD CONSTRAINT "GstInvoiceTemplate_gstSettingsId_fkey" FOREIGN KEY ("gstSettingsId") REFERENCES "GstSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstReportRun" ADD CONSTRAINT "GstReportRun_gstSettingsId_fkey" FOREIGN KEY ("gstSettingsId") REFERENCES "GstSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangePaymentInvoice" ADD CONSTRAINT "ExchangePaymentInvoice_requestPaymentId_fkey" FOREIGN KEY ("requestPaymentId") REFERENCES "RequestPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangePaymentInvoice" ADD CONSTRAINT "ExchangePaymentInvoice_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "OrderActionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutRecoveryToken" ADD CONSTRAINT "CheckoutRecoveryToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutRecoveryToken" ADD CONSTRAINT "CheckoutRecoveryToken_checkoutIntentId_fkey" FOREIGN KEY ("checkoutIntentId") REFERENCES "ExpressCheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutRecoveryToken" ADD CONSTRAINT "CheckoutRecoveryToken_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpressCheckoutAddressSnapshot" ADD CONSTRAINT "ExpressCheckoutAddressSnapshot_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "ExpressCheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpressCheckoutDiscount" ADD CONSTRAINT "ExpressCheckoutDiscount_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "ExpressCheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpressCheckoutPayment" ADD CONSTRAINT "ExpressCheckoutPayment_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "ExpressCheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpressCheckoutOrderLink" ADD CONSTRAINT "ExpressCheckoutOrderLink_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "ExpressCheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopModuleConfig" ADD CONSTRAINT "ShopModuleConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopProxyRoute" ADD CONSTRAINT "ShopProxyRoute_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopInstallationEvent" ADD CONSTRAINT "ShopInstallationEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

