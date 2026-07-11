-- CreateEnum
CREATE TYPE "PromotionRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PromotionTriggerType" AS ENUM ('PRODUCT', 'COLLECTION', 'PRODUCT_TYPE');

-- CreateEnum
CREATE TYPE "PromotionTriggerMatchMode" AS ENUM ('ANY', 'ALL');

-- CreateEnum
CREATE TYPE "PromotionRewardType" AS ENUM ('PERCENTAGE_OFF', 'FIXED_AMOUNT_OFF', 'FIXED_PRICE');

-- CreateEnum
CREATE TYPE "PromotionCompilationStatus" AS ENUM ('PENDING', 'COMPILING', 'READY', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PromotionCompilationReason" AS ENUM ('RULE_CREATED', 'RULE_UPDATED', 'MANUAL_RECOMPILE', 'COLLECTION_CHANGED', 'PRODUCT_CHANGED', 'PRODUCT_TYPE_CHANGED', 'SCHEDULE_RECONCILIATION', 'SYSTEM_REPAIR');

-- CreateTable
CREATE TABLE "PromotionRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "PromotionRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "triggerType" "PromotionTriggerType" NOT NULL,
    "triggerMatchMode" "PromotionTriggerMatchMode" NOT NULL DEFAULT 'ANY',
    "minimumTriggerQuantity" INTEGER NOT NULL DEFAULT 1,
    "minimumCartSubtotal" DECIMAL(18,4),
    "offerProductGid" TEXT NOT NULL,
    "offerProductHandle" TEXT,
    "offerProductTitle" TEXT,
    "offerProductImageUrl" TEXT,
    "rewardType" "PromotionRewardType" NOT NULL,
    "rewardValue" DECIMAL(18,4) NOT NULL,
    "maximumRewardQuantity" INTEGER NOT NULL DEFAULT 1,
    "heading" TEXT,
    "badgeText" TEXT,
    "customerMessage" TEXT,
    "ctaText" TEXT,
    "combinesWithProductDiscounts" BOOLEAN NOT NULL DEFAULT false,
    "combinesWithOrderDiscounts" BOOLEAN NOT NULL DEFAULT true,
    "combinesWithShippingDiscounts" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "currentCompilationId" TEXT,
    "compiledAt" TIMESTAMP(3),
    "createdByType" TEXT,
    "createdById" TEXT,
    "updatedByType" TEXT,
    "updatedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromotionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionTriggerReference" (
    "id" TEXT NOT NULL,
    "promotionRuleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sourceType" "PromotionTriggerType" NOT NULL,
    "referenceGid" TEXT,
    "referenceValue" TEXT,
    "normalizedValue" TEXT,
    "displayTitle" TEXT,
    "displayHandle" TEXT,
    "displayImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromotionTriggerReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionCompilation" (
    "id" TEXT NOT NULL,
    "promotionRuleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PromotionCompilationStatus" NOT NULL DEFAULT 'PENDING',
    "reason" "PromotionCompilationReason" NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "compiledHash" TEXT,
    "triggerType" "PromotionTriggerType" NOT NULL,
    "membershipCount" INTEGER NOT NULL DEFAULT 0,
    "storefrontPayload" JSONB,
    "functionPayload" JSONB,
    "diagnosticPayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromotionCompilation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionCompiledMembership" (
    "id" TEXT NOT NULL,
    "promotionCompilationId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "sourceReferenceId" TEXT,
    "sourceType" "PromotionTriggerType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromotionCompiledMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionAuditLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "promotionRuleId" TEXT,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "previousState" JSONB,
    "nextState" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromotionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRule_currentCompilationId_key" ON "PromotionRule"("currentCompilationId");
CREATE INDEX "PromotionRule_shopId_status_idx" ON "PromotionRule"("shopId", "status");
CREATE INDEX "PromotionRule_shopId_priority_idx" ON "PromotionRule"("shopId", "priority");
CREATE INDEX "PromotionRule_shopId_startsAt_endsAt_idx" ON "PromotionRule"("shopId", "startsAt", "endsAt");
CREATE INDEX "PromotionRule_shopId_triggerType_idx" ON "PromotionRule"("shopId", "triggerType");
CREATE INDEX "PromotionRule_shopId_offerProductGid_idx" ON "PromotionRule"("shopId", "offerProductGid");
CREATE INDEX "PromotionRule_shopId_archivedAt_idx" ON "PromotionRule"("shopId", "archivedAt");
CREATE UNIQUE INDEX "PromotionTriggerReference_promotionRuleId_sourceType_referenceGid_key" ON "PromotionTriggerReference"("promotionRuleId", "sourceType", "referenceGid");
CREATE UNIQUE INDEX "PromotionTriggerReference_promotionRuleId_sourceType_normalizedValue_key" ON "PromotionTriggerReference"("promotionRuleId", "sourceType", "normalizedValue");
CREATE INDEX "PromotionTriggerReference_promotionRuleId_position_idx" ON "PromotionTriggerReference"("promotionRuleId", "position");
CREATE INDEX "PromotionTriggerReference_sourceType_referenceGid_idx" ON "PromotionTriggerReference"("sourceType", "referenceGid");
CREATE INDEX "PromotionTriggerReference_sourceType_normalizedValue_idx" ON "PromotionTriggerReference"("sourceType", "normalizedValue");
CREATE UNIQUE INDEX "PromotionCompilation_promotionRuleId_version_key" ON "PromotionCompilation"("promotionRuleId", "version");
CREATE INDEX "PromotionCompilation_promotionRuleId_status_idx" ON "PromotionCompilation"("promotionRuleId", "status");
CREATE INDEX "PromotionCompilation_status_requestedAt_idx" ON "PromotionCompilation"("status", "requestedAt");
CREATE INDEX "PromotionCompilation_sourceHash_idx" ON "PromotionCompilation"("sourceHash");
CREATE INDEX "PromotionCompilation_compiledHash_idx" ON "PromotionCompilation"("compiledHash");
CREATE UNIQUE INDEX "PromotionCompiledMembership_promotionCompilationId_productGid_key" ON "PromotionCompiledMembership"("promotionCompilationId", "productGid");
CREATE INDEX "PromotionCompiledMembership_promotionCompilationId_idx" ON "PromotionCompiledMembership"("promotionCompilationId");
CREATE INDEX "PromotionCompiledMembership_productGid_idx" ON "PromotionCompiledMembership"("productGid");
CREATE INDEX "PromotionCompiledMembership_sourceType_productGid_idx" ON "PromotionCompiledMembership"("sourceType", "productGid");
CREATE INDEX "PromotionAuditLog_shopId_createdAt_idx" ON "PromotionAuditLog"("shopId", "createdAt");
CREATE INDEX "PromotionAuditLog_promotionRuleId_createdAt_idx" ON "PromotionAuditLog"("promotionRuleId", "createdAt");
CREATE INDEX "PromotionAuditLog_action_createdAt_idx" ON "PromotionAuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "PromotionRule" ADD CONSTRAINT "PromotionRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionRule" ADD CONSTRAINT "PromotionRule_currentCompilationId_fkey" FOREIGN KEY ("currentCompilationId") REFERENCES "PromotionCompilation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromotionTriggerReference" ADD CONSTRAINT "PromotionTriggerReference_promotionRuleId_fkey" FOREIGN KEY ("promotionRuleId") REFERENCES "PromotionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionCompilation" ADD CONSTRAINT "PromotionCompilation_promotionRuleId_fkey" FOREIGN KEY ("promotionRuleId") REFERENCES "PromotionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionCompiledMembership" ADD CONSTRAINT "PromotionCompiledMembership_promotionCompilationId_fkey" FOREIGN KEY ("promotionCompilationId") REFERENCES "PromotionCompilation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionAuditLog" ADD CONSTRAINT "PromotionAuditLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionAuditLog" ADD CONSTRAINT "PromotionAuditLog_promotionRuleId_fkey" FOREIGN KEY ("promotionRuleId") REFERENCES "PromotionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
