-- Multi-tenant integrity: enforce WalletReservation.shopId NOT NULL.
--
-- The prior backfill (20260729120000_backfill_wallet_reservation_shopid) plus
-- the shop-scoped reservation writers (createWalletReservation now requires a
-- shopId) mean every row is already scoped. We re-run the backfill defensively
-- to catch any row created between that migration and this one, then flip the
-- constraint and tighten the foreign key.

-- 1. Defensive re-backfill from the owning WalletAccount (its shopId is NOT NULL
--    and reservations cascade from it, so this resolves every remaining row).
UPDATE "WalletReservation" AS r
   SET "shopId" = wa."shopId"
  FROM "WalletAccount" AS wa
 WHERE wa."id" = r."walletAccountId"
   AND r."shopId" IS NULL;

-- 2. Enforce NOT NULL.
ALTER TABLE "WalletReservation" ALTER COLUMN "shopId" SET NOT NULL;

-- 3. The relation is now required; recreate the FK with ON DELETE CASCADE
--    (a reservation cannot outlive its shop). ON DELETE SET NULL is invalid for
--    a NOT NULL column.
ALTER TABLE "WalletReservation" DROP CONSTRAINT IF EXISTS "WalletReservation_shopId_fkey";
ALTER TABLE "WalletReservation"
  ADD CONSTRAINT "WalletReservation_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
