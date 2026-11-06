-- Cancellation, issue and refund updates get their own switch (they shared exchangeEnabled).
ALTER TABLE "MerchantWhatsAppAccount" ADD COLUMN "requestUpdatesEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Keep what each shop had: whoever had the shared switch on keeps both on.
UPDATE "MerchantWhatsAppAccount" SET "requestUpdatesEnabled" = "exchangeEnabled";
