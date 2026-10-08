-- WhatsApp AI assistant: SOFT handoffs keep the assistant answering, HARD (or null) silence it.
ALTER TABLE "WhatsAppConversation" ADD COLUMN "handoffKind" TEXT;
