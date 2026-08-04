-- Retry marker for mirroring a CREDIT ledger entry onto the customer's Shopify gift
-- card. The WalletTransaction ledger is the source of truth; the gift card is a
-- projection of it. This timestamp is set only after the Shopify credit succeeds, so a
-- transient failure (Shopify down, scope not yet consented) leaves it NULL for a later
-- retry. Debits are never projected and keep it NULL.
ALTER TABLE "WalletTransaction"
  ADD COLUMN "giftCardSyncedAt" TIMESTAMP(3);
