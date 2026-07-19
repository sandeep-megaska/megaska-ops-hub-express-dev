CREATE TYPE "CustomerIdentityReconciliationStatus" AS ENUM ('DRAFT', 'APPROVED', 'APPLYING', 'APPLIED', 'FAILED', 'CANCELLED');

CREATE TABLE "CustomerIdentityReconciliationPlan" (
  "id" TEXT PRIMARY KEY,
  "shopId" TEXT NOT NULL REFERENCES "Shop"("id") ON DELETE RESTRICT,
  "canonicalCustomerProfileId" TEXT NOT NULL REFERENCES "CustomerProfile"("id") ON DELETE RESTRICT,
  "sourceCustomerProfileIds" TEXT[] NOT NULL,
  "classification" TEXT NOT NULL,
  "status" "CustomerIdentityReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
  "createdBy" TEXT NOT NULL, "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "appliedAt" TIMESTAMP(3),
  "checksum" TEXT NOT NULL UNIQUE, "sourceStateChecksum" TEXT NOT NULL, "plan" JSONB NOT NULL,
  "failureReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "CustomerIdentityReconciliationPlan_shopId_status_createdAt_idx" ON "CustomerIdentityReconciliationPlan"("shopId", "status", "createdAt");

CREATE TABLE "CustomerIdentityMerge" (
  "id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL REFERENCES "Shop"("id") ON DELETE RESTRICT,
  "sourceCustomerProfileId" TEXT NOT NULL UNIQUE, "targetCustomerProfileId" TEXT NOT NULL,
  "planId" TEXT NOT NULL REFERENCES "CustomerIdentityReconciliationPlan"("id") ON DELETE RESTRICT,
  "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CustomerIdentityMerge_shopId_targetCustomerProfileId_idx" ON "CustomerIdentityMerge"("shopId", "targetCustomerProfileId");
CREATE INDEX "CustomerIdentityMerge_planId_idx" ON "CustomerIdentityMerge"("planId");

CREATE TABLE "CustomerIdentityReconciliationAudit" (
  "id" TEXT PRIMARY KEY, "planId" TEXT NOT NULL REFERENCES "CustomerIdentityReconciliationPlan"("id") ON DELETE RESTRICT,
  "shopId" TEXT NOT NULL REFERENCES "Shop"("id") ON DELETE RESTRICT,
  "canonicalCustomerProfileId" TEXT NOT NULL REFERENCES "CustomerProfile"("id") ON DELETE RESTRICT,
  "sourceCustomerProfileIds" TEXT[] NOT NULL, "classification" TEXT NOT NULL,
  "affectedRecordCounts" JSONB NOT NULL, "result" TEXT NOT NULL, "failureReason" TEXT,
  "actor" TEXT NOT NULL, "beforeIntegrityHash" TEXT NOT NULL, "afterIntegrityHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CustomerIdentityReconciliationAudit_shopId_createdAt_idx" ON "CustomerIdentityReconciliationAudit"("shopId", "createdAt");
CREATE INDEX "CustomerIdentityReconciliationAudit_planId_idx" ON "CustomerIdentityReconciliationAudit"("planId");
