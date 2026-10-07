import { NextRequest, NextResponse } from "next/server";
import { checkMetaWebhookChallenge } from "../../../../services/whatsapp";
import { consentKeyword, recordWhatsAppConsent } from "../../../../services/whatsapp/consent";
import { applyStatusUpdates, recordInboundMessages, type WebhookValue } from "../../../../services/whatsapp/inbox";
import { verifyMetaSignature } from "../../../../services/whatsapp/webhook-signature";

export const runtime = "nodejs";

// Meta WhatsApp Cloud API webhook (subscribe the app to the WABA's "messages"
// field and point it here). GET answers Meta's verification challenge with
// WHATSAPP_META_WEBHOOK_VERIFY_TOKEN; POST is signed with the Meta app secret
// in X-Hub-Signature-256. WHATSAPP_META_APP_SECRET may list several secrets
// (comma-separated) when numbers live in different Meta apps. Opt-outs are
// recorded against the business number that received the reply.
//
// Handled: every customer message is stored in the LoopD2C WhatsApp inbox
// (Admin → WhatsApp Inbox) for shops whose own number received it; STOP /
// "Stop promotions" style replies also record an opt-out that checkout-recovery
// sends respect, START an opt-in; delivery statuses update the inbox ticks and
// failures are logged.

type WhatsAppWebhookMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string; id?: string } };
};

type WhatsAppWebhookStatus = {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string }>;
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{ changes?: Array<{ field?: string; value?: { metadata?: { phone_number_id?: string }; messages?: WhatsAppWebhookMessage[]; statuses?: WhatsAppWebhookStatus[] } }> }>;
};

function messageText(message: WhatsAppWebhookMessage) {
  return message.text?.body || message.button?.text || message.button?.payload || message.interactive?.button_reply?.title || "";
}

export async function GET(request: NextRequest) {
  const result = checkMetaWebhookChallenge(request.nextUrl.searchParams);
  if (!result.ok) {
    console.warn("[WHATSAPP] webhook_verification_failed", { reason: result.reason, vercelEnv: process.env.VERCEL_ENV || null });
    return new NextResponse(`Forbidden: ${result.reason}`, { status: 403, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse(result.challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const appSecrets = String(process.env.WHATSAPP_META_APP_SECRET || "").split(",").map((value) => value.trim()).filter(Boolean);
  const signature = request.headers.get("x-hub-signature-256");
  if (!appSecrets.some((secret) => verifyMetaSignature(rawBody, signature, secret))) {
    console.warn("[WHATSAPP] webhook_signature_invalid", { appSecrets: appSecrets.length });
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const businessNumberId = String(change.value?.metadata?.phone_number_id || "");
      for (const message of change.value?.messages || []) {
        const action = consentKeyword(messageText(message));
        if (!action || !message.from || !businessNumberId) continue;
        await recordWhatsAppConsent(message.from, businessNumberId, action, { source: "whatsapp_webhook", messageId: message.id || null, messageType: message.type || null });
        console.log("[WHATSAPP] consent_recorded", { action, messageId: message.id || null });
      }
      try {
        await recordInboundMessages(change.value as WebhookValue);
        await applyStatusUpdates(change.value as WebhookValue);
      } catch (error) {
        console.error("[WHATSAPP] inbox_store_failed", { error: error instanceof Error ? error.message : String(error) });
      }
      for (const status of change.value?.statuses || []) {
        if (status.status !== "failed") continue;
        console.warn("[WHATSAPP] message_delivery_failed", { messageId: status.id || null, errors: (status.errors || []).map((error) => ({ code: error.code, title: error.title })) });
      }
    }
  }

  // Always 200 once verified so Meta does not retry and disable the webhook.
  return NextResponse.json({ ok: true });
}
