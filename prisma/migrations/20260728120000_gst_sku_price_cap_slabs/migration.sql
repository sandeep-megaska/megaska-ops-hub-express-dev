-- Per-SKU price-cap slab: an optional threshold plus the rates that apply above
-- it. Existing rows keep taxRate/cessRate as the flat (and at-or-below) rate;
-- priceCapThreshold NULL means no slab, so behaviour is unchanged for them.
ALTER TABLE "GstSkuTaxMap"
  ADD COLUMN "priceCapThreshold" DECIMAL(14, 2),
  ADD COLUMN "taxRateAbove" DECIMAL(5, 2),
  ADD COLUMN "cessRateAbove" DECIMAL(5, 2) NOT NULL DEFAULT 0;
