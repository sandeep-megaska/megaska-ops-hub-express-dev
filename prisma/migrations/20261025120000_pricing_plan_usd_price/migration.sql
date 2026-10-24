-- USD price charged to stores whose Shopify billing currency isn't the plan's currency
-- (Shopify only accepts USD or the store's own billing currency).
ALTER TABLE "PricingPlan" ADD COLUMN "usdMonthlyBasePrice" DECIMAL(18,6);

-- Launch pricing for Professional: ₹2,899 for stores billed in INR, $29 for everyone else.
UPDATE "PricingPlan" SET "monthlyBasePrice" = 2899, "usdMonthlyBasePrice" = 29, "updatedAt" = NOW() WHERE "code" = 'PROFESSIONAL';
