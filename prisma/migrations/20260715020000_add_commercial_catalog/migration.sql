CREATE TABLE "BillableFeature" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillableFeature_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PricingPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyBasePrice" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PricingPlan_monthlyBasePrice_non_negative" CHECK ("monthlyBasePrice" >= 0)
);

CREATE TABLE "PricingPlanFeature" (
    "id" TEXT NOT NULL,
    "pricingPlanId" TEXT NOT NULL,
    "billableFeatureId" TEXT NOT NULL,
    "includedQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "overageUnitPrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingPlanFeature_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PricingPlanFeature_includedQuantity_non_negative" CHECK ("includedQuantity" >= 0),
    CONSTRAINT "PricingPlanFeature_overageUnitPrice_non_negative" CHECK ("overageUnitPrice" >= 0)
);

CREATE UNIQUE INDEX "BillableFeature_code_key" ON "BillableFeature"("code");
CREATE UNIQUE INDEX "PricingPlan_code_key" ON "PricingPlan"("code");
CREATE UNIQUE INDEX "PricingPlanFeature_pricingPlanId_billableFeatureId_key" ON "PricingPlanFeature"("pricingPlanId", "billableFeatureId");
CREATE INDEX "PricingPlanFeature_billableFeatureId_idx" ON "PricingPlanFeature"("billableFeatureId");

ALTER TABLE "PricingPlanFeature" ADD CONSTRAINT "PricingPlanFeature_pricingPlanId_fkey" FOREIGN KEY ("pricingPlanId") REFERENCES "PricingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingPlanFeature" ADD CONSTRAINT "PricingPlanFeature_billableFeatureId_fkey" FOREIGN KEY ("billableFeatureId") REFERENCES "BillableFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
