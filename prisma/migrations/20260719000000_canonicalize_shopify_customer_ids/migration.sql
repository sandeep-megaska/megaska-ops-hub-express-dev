-- IDENTITY-FIX-1. This migration deliberately fails before the general backfill
-- when any unreviewed duplicate pair exists; such rows must be merged with the
-- same relation-by-relation care as the proven pair below.
DO $$
DECLARE
  survivor constant text := 'c2281142-a9dc-468a-99da-848a725e62dc';
  duplicate constant text := '1adec559-810a-4467-a5e1-d0b8648d053d';
  expected constant text := '10359580655914';
  s "CustomerProfile"%ROWTYPE;
  d "CustomerProfile"%ROWTYPE;
  relation record;
  remaining bigint;
BEGIN
  SELECT * INTO s FROM "CustomerProfile" WHERE id = survivor FOR UPDATE;
  SELECT * INTO d FROM "CustomerProfile" WHERE id = duplicate FOR UPDATE;

  -- Idempotency: a previously completed repair has no duplicate to lock.
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM "CustomerProfile" WHERE id = survivor AND "shopifyCustomerId" = expected) THEN RETURN; END IF;
    RAISE EXCEPTION 'identity repair profiles are missing';
  END IF;
  IF s."shopId" IS DISTINCT FROM d."shopId" THEN RAISE EXCEPTION 'identity repair shop mismatch'; END IF;
  IF regexp_replace(s."shopifyCustomerId", '^gid://shopify/Customer/', '') <> expected
     OR regexp_replace(d."shopifyCustomerId", '^gid://shopify/Customer/', '') <> expected THEN
    RAISE EXCEPTION 'identity repair customer ID mismatch';
  END IF;

  IF EXISTS (SELECT 1 FROM "WalletAccount" WHERE "customerProfileId" = duplicate)
     OR EXISTS (SELECT 1 FROM "ProductReview" WHERE "customerProfileId" = duplicate)
     OR EXISTS (SELECT 1 FROM "WalletTransaction" WHERE "customerProfileId" = duplicate)
     OR EXISTS (SELECT 1 FROM "RefundRequest" WHERE "customerProfileId" = duplicate) THEN
    RAISE EXCEPTION 'identity repair has wallet, review, or financial collision';
  END IF;

  UPDATE "MegaskaOrder" SET "customerProfileId" = survivor
    WHERE id = 'e961b3d4-85a6-46ff-803e-df3f6a51dcfe' AND "customerProfileId" = duplicate;
  IF NOT EXISTS (SELECT 1 FROM "MegaskaOrder" WHERE id = 'e961b3d4-85a6-46ff-803e-df3f6a51dcfe' AND "customerProfileId" = survivor) THEN
    RAISE EXCEPTION 'canonical order was not preserved';
  END IF;
  UPDATE "ReviewRequest" SET "customerProfileId" = survivor
    WHERE id = 'c6ca779d-054b-4954-b174-47b3ee6be6ec' AND "customerProfileId" = duplicate;
  IF NOT EXISTS (SELECT 1 FROM "ReviewRequest" WHERE id = 'c6ca779d-054b-4954-b174-47b3ee6be6ec' AND "customerProfileId" = survivor) THEN
    RAISE EXCEPTION 'review request was not preserved';
  END IF;

  -- Inspect every FK to CustomerProfile, including relations added after this migration was authored.
  FOR relation IN
    SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) table_name,
           quote_ident(a.attname) column_name
    FROM pg_constraint fk
    JOIN pg_class c ON c.oid = fk.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(fk.conkey) key(attnum) ON true JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key.attnum
    WHERE fk.contype = 'f' AND fk.confrelid = '"CustomerProfile"'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %s = $1', relation.table_name, relation.column_name)
      INTO remaining USING duplicate;
    IF remaining > 0 THEN RAISE EXCEPTION 'identity repair relation remains in %.% (% rows)', relation.table_name, relation.column_name, remaining; END IF;
  END LOOP;

  DELETE FROM "CustomerProfile" WHERE id = duplicate;
  UPDATE "CustomerProfile" SET "shopifyCustomerId" = expected WHERE id = survivor;
  INSERT INTO "AuditEvent" (id, "actorType", "eventType", "entityType", "entityId", payload, "createdAt")
  VALUES (gen_random_uuid(), 'system', 'customer_profile.identity_repaired', 'CustomerProfile', survivor,
    jsonb_build_object('survivorId', survivor, 'duplicateId', duplicate, 'canonicalShopifyCustomerId', expected,
      'movedMegaskaOrderIds', jsonb_build_array('e961b3d4-85a6-46ff-803e-df3f6a51dcfe'),
      'movedReviewRequestIds', jsonb_build_array('c6ca779d-054b-4954-b174-47b3ee6be6ec'),
      'walletBalanceModified', false), now());
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "CustomerProfile" WHERE "shopifyCustomerId" IS NOT NULL
    GROUP BY "shopId", regexp_replace("shopifyCustomerId", '^gid://shopify/Customer/', '') HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'duplicate canonical Shopify customer IDs remain; merge before backfill'; END IF;
  IF EXISTS (SELECT 1 FROM "CustomerProfile" WHERE "shopifyCustomerId" IS NOT NULL
    AND "shopifyCustomerId" !~ '^(gid://shopify/Customer/)?[0-9]+$') THEN
    RAISE EXCEPTION 'malformed Shopify customer IDs require manual repair';
  END IF;
END $$;

UPDATE "CustomerProfile"
SET "shopifyCustomerId" = regexp_replace("shopifyCustomerId", '^gid://shopify/Customer/', '')
WHERE "shopifyCustomerId" LIKE 'gid://shopify/Customer/%';
