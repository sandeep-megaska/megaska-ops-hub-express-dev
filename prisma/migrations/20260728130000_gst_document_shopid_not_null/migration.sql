-- Multi-tenant integrity: add shopId to GstDocument and GstDocumentLine so every
-- GST row is directly shop-scoped. Previously these two tables were scoped only
-- indirectly, through gstSettingsId -> GstSettings.shopId.
--
-- The column is added nullable, backfilled deterministically from the owning
-- GstSettings.shopId (and, for lines, from the parent GstDocument), then enforced
-- NOT NULL with a Shop foreign key + index. GstSettings.shopId is already NOT NULL
-- (see 20260727100000_gst_shopid_not_null), so the backfill is complete and
-- unambiguous -- no shop-count guard is needed.

-- 1. Add columns (nullable while we backfill). IF NOT EXISTS keeps this safe on
--    the legacy production database, whose GstDocument table diverges from the
--    Prisma baseline.
ALTER TABLE "GstDocument"     ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE "GstDocumentLine" ADD COLUMN IF NOT EXISTS "shopId" TEXT;

-- 2. Backfill: documents inherit their settings' shopId; lines inherit their
--    parent document's shopId.
UPDATE "GstDocument" AS d
   SET "shopId" = s."shopId"
  FROM "GstSettings" AS s
 WHERE d."gstSettingsId" = s."id"
   AND d."shopId" IS NULL;

UPDATE "GstDocumentLine" AS l
   SET "shopId" = d."shopId"
  FROM "GstDocument" AS d
 WHERE l."gstDocumentId" = d."id"
   AND l."shopId" IS NULL;

-- 3. Abort rather than silently enforce NOT NULL if any orphaned rows remain.
DO $$
DECLARE
  doc_nulls  integer;
  line_nulls integer;
BEGIN
  SELECT count(*) INTO doc_nulls  FROM "GstDocument"     WHERE "shopId" IS NULL;
  SELECT count(*) INTO line_nulls FROM "GstDocumentLine" WHERE "shopId" IS NULL;
  IF doc_nulls > 0 OR line_nulls > 0 THEN
    RAISE EXCEPTION 'GstDocument shopId backfill incomplete: % document row(s) and % line row(s) still null. Resolve orphaned rows (missing GstSettings/parent document) before running this migration.', doc_nulls, line_nulls;
  END IF;
END $$;

-- 4. Enforce NOT NULL now that every row is populated.
ALTER TABLE "GstDocument"     ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "GstDocumentLine" ALTER COLUMN "shopId" SET NOT NULL;

-- 5. Foreign keys to Shop (ON DELETE CASCADE, consistent with the other GST
--    tables) and supporting indexes.
ALTER TABLE "GstDocument"     DROP CONSTRAINT IF EXISTS "GstDocument_shopId_fkey";
ALTER TABLE "GstDocument"     ADD  CONSTRAINT "GstDocument_shopId_fkey"     FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GstDocumentLine" DROP CONSTRAINT IF EXISTS "GstDocumentLine_shopId_fkey";
ALTER TABLE "GstDocumentLine" ADD  CONSTRAINT "GstDocumentLine_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "GstDocument_shopId_idx"     ON "GstDocument"("shopId");
CREATE INDEX IF NOT EXISTS "GstDocumentLine_shopId_idx" ON "GstDocumentLine"("shopId");
