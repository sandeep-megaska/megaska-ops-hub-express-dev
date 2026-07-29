-- Multi-tenant integrity: backfill WalletReservation.shopId for legacy rows that
-- were created before the reservation writers set a shop scope.
--
-- Every reservation links to a WalletAccount (WalletReservation.walletAccountId,
-- ON DELETE CASCADE so there are no orphans), and WalletAccount.shopId is NOT
-- NULL, so the owning account's shopId is a complete and unambiguous source.
--
-- The column is left nullable here on purpose: the reservation writers now
-- always supply a shopId (createWalletReservation throws without one), so no new
-- null-scoped rows can appear. Flipping the column to NOT NULL is a follow-up
-- migration to run once this backfill is confirmed complete in each environment.

UPDATE "WalletReservation" AS r
   SET "shopId" = wa."shopId",
       "updatedAt" = NOW()
  FROM "WalletAccount" AS wa
 WHERE wa."id" = r."walletAccountId"
   AND r."shopId" IS NULL;
