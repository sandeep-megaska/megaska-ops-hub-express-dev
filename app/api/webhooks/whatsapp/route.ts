import { NextRequest, NextResponse } from "next/server";
import { verifyMetaWebhookChallenge } from "../../../../services/whatsapp";
import { consentKeyword, recordWhatsAppConsent } from "../../../../services/whatsapp/consent";
import { verifyMetaSignature } from "../../../../services/whatsapp/webhook-signature";

export const runtime = "nodejs";

// Meta WhatsApp Cloud API webhook (subscribe the app to the WABA's "messages"
// field and point it here). GET answers Meta's verification challenge with
// WHATSAPP_META_WEBHOOK_VERIFY_TOKEN; POST is signed with the Meta app secret
// (WHATSAPP_META_APP_SECRET) in X-Hub-Signature-256.
//
// Handled: STOP / "Stop promotions" style replies record an opt-out that
// checkout-recovery sends respect; START records an opt-in. Failed delivery
// statuses are logged. Everything else is acknowledged and left to the
// WhatsApp Business app, where the team reads and answers chats.

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
  entry?: Array<{ changes?: Array<{ field?: string; value?: { messages?: WhatsAppWebhookMessage[]; statuses?: WhatsAppWebhookStatus[] } }> }>;
};

function messageText(message: WhatsAppWebhookMessage) {
  return message.text?.body || message.button?.text || message.button?.payload || message.interactive?.button_reply?.title || "";
}

export async function GET(request: NextRequest) {
  const challenge = verifyMetaWebhookChallenge(request.nextUrl.searchParams);
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const appSecret = String(process.env.WHATSAPP_META_APP_SECRET || "").trim();
  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    console.warn("[WHATSAPP] webhook_signature_invalid", { hasAppSecret: Boolean(appSecret) });
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
      for (const message of change.value?.messages || []) {
        const action = consentKeyword(messageText(message));
        if (!action || !message.from) continue;
        await recordWhatsAppConsent(message.from, action, { source: "whatsapp_webhook", messageId: message.id || null, messageType: message.type || null });
        console.log("[WHATSAPP] consent_recorded", { action, messageId: message.id || null });
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
