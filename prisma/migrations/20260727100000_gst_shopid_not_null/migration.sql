-- Multi-tenant integrity: no GST row may have shopId = NULL.
--
-- Backfills any null-shopId GST rows to the single installed shop, then makes
-- shopId NOT NULL on the four GST tables and switches the Shop foreign key from
-- ON DELETE SET NULL to ON DELETE CASCADE (a NOT NULL column cannot be set null
-- on delete). Guarded: if null rows exist while more than one shop is installed,
-- the migration aborts rather than guess ownership.

DO $$
DECLARE
  the_shop   text;
  shop_count integer;
  null_count integer;
BEGIN
  SELECT count(*) INTO shop_count FROM "Shop";

  SELECT (SELECT count(*) FROM "GstSettings"      WHERE "shopId" IS NULL)
       + (SELECT count(*) FROM "GstSkuTaxMap"     WHERE "shopId" IS NULL)
       + (SELECT count(*) FROM "GstProductTaxMap" WHERE "shopId" IS NULL)
       + (SELECT count(*) FROM "GstOrderImport"   WHERE "shopId" IS NULL)
    INTO null_count;

  IF null_count > 0 THEN
    IF shop_count <> 1 THEN
      RAISE EXCEPTION 'GST shopId backfill aborted: % null GST rows but % shops (expected exactly 1). Assign or remove the null rows manually before running this migration.', null_count, shop_count;
    END IF;

    SELECT "id" INTO the_shop FROM "Shop" LIMIT 1;  -- the sole shop, regardless of isActive

    UPDATE "GstSettings"      SET "shopId" = the_shop WHERE "shopId" IS NULL;
    UPDATE "GstSkuTaxMap"     SET "shopId" = the_shop WHERE "shopId" IS NULL;
    UPDATE "GstProductTaxMap" SET "shopId" = the_shop WHERE "shopId" IS NULL;
    UPDATE "GstOrderImport"   SET "shopId" = the_shop WHERE "shopId" IS NULL;

    RAISE NOTICE 'GST shopId backfill: assigned % null row(s) to shop %', null_count, the_shop;
  END IF;
END $$;

-- Enforce NOT NULL now that no null rows remain.
ALTER TABLE "GstSettings"      ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "GstSkuTaxMap"     ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "GstProductTaxMap" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "GstOrderImport"   ALTER COLUMN "shopId" SET NOT NULL;

-- Replace the SET NULL foreign keys with CASCADE (valid for a NOT NULL column).
ALTER TABLE "GstSettings"      DROP CONSTRAINT IF EXISTS "GstSettings_shopId_fkey";
ALTER TABLE "GstSettings"      ADD  CONSTRAINT "GstSettings_shopId_fkey"      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GstSkuTaxMap"     DROP CONSTRAINT IF EXISTS "GstSkuTaxMap_shopId_fkey";
ALTER TABLE "GstSkuTaxMap"     ADD  CONSTRAINT "GstSkuTaxMap_shopId_fkey"     FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GstProductTaxMap" DROP CONSTRAINT IF EXISTS "GstProductTaxMap_shopId_fkey";
ALTER TABLE "GstProductTaxMap" ADD  CONSTRAINT "GstProductTaxMap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GstOrderImport"   DROP CONSTRAINT IF EXISTS "GstOrderImport_shopId_fkey";
ALTER TABLE "GstOrderImport"   ADD  CONSTRAINT "GstOrderImport_shopId_fkey"   FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
