-- Portable identity cleanup only. Environment-specific duplicate repair belongs in
-- scripts/dev-repair-customer-profile-duplicate.mjs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CustomerProfile"
    WHERE "shopifyCustomerId" IS NOT NULL
      AND btrim("shopifyCustomerId") !~ '^(gid://shopify/Customer/)?[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'Malformed CustomerProfile.shopifyCustomerId values exist';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CustomerProfile"
    WHERE "shopifyCustomerId" IS NOT NULL
    GROUP BY "shopId", regexp_replace(btrim("shopifyCustomerId"), '^gid://shopify/Customer/', '')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Unresolved canonical Shopify customer duplicates exist; run the protected development repair first';
  END IF;
END $$;

UPDATE "CustomerProfile"
SET "shopifyCustomerId" = regexp_replace(btrim("shopifyCustomerId"), '^gid://shopify/Customer/', '')
WHERE "shopifyCustomerId" IS NOT NULL
  AND "shopifyCustomerId" IS DISTINCT FROM regexp_replace(btrim("shopifyCustomerId"), '^gid://shopify/Customer/', '');
