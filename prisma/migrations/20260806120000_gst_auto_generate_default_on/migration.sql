-- Pre-generation architecture: GST invoices are generated when the order is
-- created (orders/create webhook), so the merchant popup just displays a ready
-- invoice instead of generating it on click.
--
-- 1) Flip the column default so every new GstSettings row auto-generates.
ALTER TABLE "GstSettings" ALTER COLUMN "autoGenerateOnOrderCreate" SET DEFAULT true;

-- 2) Enable it for existing shops. The flag historically defaulted to false, so
--    every current row is false-by-default rather than a deliberate opt-out;
--    turning it on makes pre-generation the standing behavior. Merchants can
--    still opt out afterwards via the GST Settings toggle.
UPDATE "GstSettings" SET "autoGenerateOnOrderCreate" = true WHERE "autoGenerateOnOrderCreate" = false;
