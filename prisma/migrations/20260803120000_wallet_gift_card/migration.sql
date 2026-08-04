-- Store credit is mirrored to a Shopify gift card so it can be applied natively at
-- Shopify Checkout (the modal-free architecture cannot inject a custom tender). One
-- persistent card per customer: the gift-card id + last 4, plus the full code stored
-- encrypted (Shopify never returns the code after creation) for the app dashboard.
ALTER TABLE "WalletAccount"
  ADD COLUMN "shopifyGiftCardId" TEXT,
  ADD COLUMN "shopifyGiftCardLast4" TEXT,
  ADD COLUMN "giftCardCodeEnc" TEXT;
