-- Click-to-WhatsApp ads: remember the ad behind a chat and report purchases to Meta.
ALTER TABLE "WhatsAppConversation"
  ADD COLUMN IF NOT EXISTS "adSourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "adHeadline" TEXT,
  ADD COLUMN IF NOT EXISTS "adBody" TEXT,
  ADD COLUMN IF NOT EXISTS "adCtwaClid" TEXT,
  ADD COLUMN IF NOT EXISTS "adReferredAt" TIMESTAMP(3);
ALTER TABLE "MerchantWhatsAppAccount"
  ADD COLUMN IF NOT EXISTS "adConversionsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "capiDatasetId" TEXT;
