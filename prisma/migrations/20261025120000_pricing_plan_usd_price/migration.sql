-- USD price charged to stores whose Shopify billing currency isn't the plan's currency
-- (Shopify only accepts USD or the store's own billing currency).
ALTER TABLE "PricingPlan" ADD COLUMN "usdMonthlyBasePrice" DECIMAL(18,6);
