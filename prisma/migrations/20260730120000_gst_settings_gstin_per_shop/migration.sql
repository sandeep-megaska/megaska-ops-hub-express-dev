-- GstSettings.gstin was globally UNIQUE, which breaks multi-tenancy: a business
-- migrating from another GST app (or running multiple stores) legitimately reuses
-- one GSTIN, and the reused legacy production DB already holds rows under other
-- shops. A new shop's create() then fails with a P2002 on gstin. Scope the
-- uniqueness to the shop instead: unique per (shopId, gstin).
--
-- Note: this compares attribute NUMBERS (conkey) rather than aggregating column
-- names, to avoid the Postgres `name[] = text[]` operator error.

-- 1. Drop any single-column UNIQUE CONSTRAINT on (gstin), whatever its name
--    (name-agnostic: works on the Prisma-managed schema and the legacy prod schema).
DO $$
DECLARE
  r record;
  gstin_attnum smallint;
BEGIN
  SELECT attnum INTO gstin_attnum
    FROM pg_attribute
   WHERE attrelid = '"GstSettings"'::regclass
     AND attname = 'gstin'
     AND NOT attisdropped;

  IF gstin_attnum IS NOT NULL THEN
    FOR r IN
      SELECT conname
        FROM pg_constraint
       WHERE conrelid = '"GstSettings"'::regclass
         AND contype = 'u'
         AND conkey = ARRAY[gstin_attnum]
    LOOP
      EXECUTE format('ALTER TABLE "GstSettings" DROP CONSTRAINT %I', r.conname);
    END LOOP;
  END IF;
END $$;

-- 2. Drop the standard bare unique index on (gstin) if one exists without a
--    backing constraint.
DROP INDEX IF EXISTS "GstSettings_gstin_key";

-- 3. Add shop-scoped uniqueness (matches @@unique([shopId, gstin])).
CREATE UNIQUE INDEX IF NOT EXISTS "GstSettings_shopId_gstin_key"
  ON "GstSettings" ("shopId", "gstin");
