-- GST multi-tenant integrity audit: shopId = NULL rows
--
-- READ-ONLY. Every statement is a SELECT; this script makes no changes.
-- Run against the target database before the NOT NULL / backfill migration, e.g.:
--   psql "$DATABASE_URL" -f scripts/gst-shopid-null-audit.sql
--
-- Purpose: in a public multi-tenant app no GST row should have shopId = NULL.
-- This reports how many such rows exist, how many shops are installed, and
-- whether GST data spans more than one shop -- which together decide whether a
-- single-shop backfill is safe or the null rows must be handled individually.

\echo '== 1. NULL shopId row counts per GST table =='
SELECT 'GstSettings'      AS gst_table, COUNT(*) FILTER (WHERE "shopId" IS NULL) AS null_rows, COUNT(*) AS total_rows FROM "GstSettings"
UNION ALL
SELECT 'GstSkuTaxMap',      COUNT(*) FILTER (WHERE "shopId" IS NULL), COUNT(*) FROM "GstSkuTaxMap"
UNION ALL
SELECT 'GstProductTaxMap',  COUNT(*) FILTER (WHERE "shopId" IS NULL), COUNT(*) FROM "GstProductTaxMap"
UNION ALL
SELECT 'GstOrderImport',    COUNT(*) FILTER (WHERE "shopId" IS NULL), COUNT(*) FROM "GstOrderImport"
ORDER BY gst_table;

\echo '== 2. Installed shops (is a single-shop backfill safe?) =='
SELECT COUNT(*) AS shop_count FROM "Shop";
SELECT "id", "shopDomain", "myshopifyDomain", "installationStatus", "isActive"
FROM "Shop"
ORDER BY "isActive" DESC, "installationStatus";

\echo '== 3. Distinct non-null shopIds actually used in GST tables (does data span >1 shop?) =='
SELECT 'GstSettings'     AS gst_table, "shopId", COUNT(*) AS rows FROM "GstSettings"     WHERE "shopId" IS NOT NULL GROUP BY "shopId"
UNION ALL
SELECT 'GstSkuTaxMap',     "shopId", COUNT(*) FROM "GstSkuTaxMap"     WHERE "shopId" IS NOT NULL GROUP BY "shopId"
UNION ALL
SELECT 'GstProductTaxMap', "shopId", COUNT(*) FROM "GstProductTaxMap" WHERE "shopId" IS NOT NULL GROUP BY "shopId"
UNION ALL
SELECT 'GstOrderImport',   "shopId", COUNT(*) FROM "GstOrderImport"   WHERE "shopId" IS NOT NULL GROUP BY "shopId"
ORDER BY gst_table, rows DESC;

\echo '== 4. Sample of NULL-shopId SKU mappings (what a backfill/delete would touch) =='
SELECT "id", "sku", "styleCode", "hsnCode", "taxRate", "cessRate", "source", "status", "updatedAt"
FROM "GstSkuTaxMap"
WHERE "shopId" IS NULL
ORDER BY "updatedAt" DESC
LIMIT 50;

\echo '== 5. Sample of NULL-shopId order imports =='
SELECT "id", "shopifyOrderName", "shopifyOrderId", "importStatus", "eligibilityStatus", "updatedAt"
FROM "GstOrderImport"
WHERE "shopId" IS NULL
ORDER BY "updatedAt" DESC
LIMIT 50;
