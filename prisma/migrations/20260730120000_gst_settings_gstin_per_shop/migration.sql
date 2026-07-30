-- GstSettings.gstin was globally UNIQUE, which breaks multi-tenancy: a business
-- migrating from another GST app (or running multiple stores) legitimately reuses
-- one GSTIN, and the reused legacy production DB already holds rows under other
-- shops. A new shop's create() then fails with a P2002 on gstin. Scope the
-- uniqueness to the shop instead: unique per (shopId, gstin).

-- 1. Drop any UNIQUE CONSTRAINT that covers exactly (gstin). Name-agnostic so it
--    works on both the Prisma-managed schema (GstSettings_gstin_key) and any
--    differently-named constraint on the legacy production database.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'GstSettings'
       AND con.contype = 'u'
       AND (
         SELECT array_agg(a.attname ORDER BY a.attnum)
           FROM unnest(con.conkey) AS k
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k
       ) = ARRAY['gstin']
  LOOP
    EXECUTE format('ALTER TABLE "GstSettings" DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 2. Drop any bare UNIQUE INDEX on (gstin) that is not backed by a constraint.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.relname AS idxname
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace nsp ON nsp.oid = t.relnamespace
     WHERE nsp.nspname = 'public'
       AND t.relname = 'GstSettings'
       AND x.indisunique
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)
       AND (
         SELECT array_agg(a.attname ORDER BY a.attnum)
           FROM pg_attribute a
          WHERE a.attrelid = t.oid AND a.attnum = ANY (x.indkey)
       ) = ARRAY['gstin']
  LOOP
    EXECUTE format('DROP INDEX %I', r.idxname);
  END LOOP;
END $$;

-- 3. Add shop-scoped uniqueness (matches @@unique([shopId, gstin])).
CREATE UNIQUE INDEX IF NOT EXISTS "GstSettings_shopId_gstin_key"
  ON "GstSettings" ("shopId", "gstin");
