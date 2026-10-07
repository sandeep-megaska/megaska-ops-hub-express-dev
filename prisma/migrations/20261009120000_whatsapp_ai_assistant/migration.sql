-- WhatsApp AI assistant: per-shop mode + notes, per-chat handoff/pause/draft, AI-sent flag.
ALTER TABLE "MerchantWhatsAppAccount" ADD COLUMN "aiMode" TEXT NOT NULL DEFAULT 'OFF';
ALTER TABLE "MerchantWhatsAppAccount" ADD COLUMN "aiKnowledge" TEXT;

ALTER TABLE "WhatsAppConversation" ADD COLUMN "needsHuman" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsAppConversation" ADD COLUMN "handoffReason" TEXT;
ALTER TABLE "WhatsAppConversation" ADD COLUMN "aiPausedUntil" TIMESTAMP(3);
ALTER TABLE "WhatsAppConversation" ADD COLUMN "aiDraft" TEXT;
ALTER TABLE "WhatsAppConversation" ADD COLUMN "aiDraftAt" TIMESTAMP(3);

ALTER TABLE "WhatsAppMessage" ADD COLUMN "sentByAi" BOOLEAN NOT NULL DEFAULT false;
