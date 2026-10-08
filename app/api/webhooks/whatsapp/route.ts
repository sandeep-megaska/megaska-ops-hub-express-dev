import { after, NextRequest, NextResponse } from "next/server";
import { checkMetaWebhookChallenge } from "../../../../services/whatsapp";
import { consentKeyword, recordWhatsAppConsent } from "../../../../services/whatsapp/consent";
import { applyStatusUpdates, recordInboundMessages, type WebhookValue } from "../../../../services/whatsapp/inbox";
import { handleCodConfirmationReply, parseCodPayload } from "../../../../services/orders/whatsapp-cod-confirmation";
import { runWhatsAppAssistant } from "../../../../services/whatsapp/assistant/run";
import { handleWhatsAppCatalogOrder, type CatalogOrderItem } from "../../../../services/whatsapp/shop-in-chat";
import { recordOtpDeliveryStatuses } from "../../../../services/whatsapp/otp-delivery";
import { verifyMetaSignature } from "../../../../services/whatsapp/webhook-signature";

export const runtime = "nodejs";
// The AI assistant answers after the response is sent (see `after` below).
export const maxDuration = 60;

// Meta WhatsApp Cloud API webhook (subscribe the app to the WABA's "messages"
// field and point it here). GET answers Meta's verification challenge with
// WHATSAPP_META_WEBHOOK_VERIFY_TOKEN; POST is signed with the Meta app secret
// in X-Hub-Signature-256. WHATSAPP_META_APP_SECRET may list several secrets
// (comma-separated) when numbers live in different Meta apps. Opt-outs are
// recorded against the business number that received the reply.
//
// Handled: every customer message is stored in the LoopD2C WhatsApp inbox
// (Admin → WhatsApp Inbox) for shops whose own number received it, and the
// shop's AI assistant (if switched on) answers or drafts a reply; STOP /
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
  order?: { catalog_id?: string; product_items?: CatalogOrderItem[] };
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
      // Confirm / Cancel taps on a COD confirmation are handled here, not by the AI assistant.
      const codReplies = (change.value?.messages || []).filter((message) => message.id && message.from && parseCodPayload(message.button?.payload));
      const codReplyIds = new Set(codReplies.map((message) => message.id));
      // Carts sent from the WhatsApp catalog ("Place order") become a Shopify bag link.
      const catalogOrders = new Map((change.value?.messages || []).filter((message) => message.type === "order" && message.id).map((message) => [String(message.id), message.order?.product_items ?? []]));
      try {
        await recordInboundMessages(change.value as WebhookValue, {
          // AI assistant (Merchant WhatsApp → AI assistant), after Meta has its 200.
          onStored: (stored) => codReplyIds.has(stored.waMessageId) ? undefined : catalogOrders.has(stored.waMessageId) ? after(() => handleWhatsAppCatalogOrder({ ...stored, items: catalogOrders.get(stored.waMessageId) ?? [] })
            .then((result) => console.info("[WHATSAPP SHOP] order", { conversationId: stored.conversationId, ...result }))
            .catch((error) => console.error("[WHATSAPP SHOP] order_failed", { conversationId: stored.conversationId, error: error instanceof Error ? error.message : String(error) }))) : after(() => runWhatsAppAssistant(stored)
            .then((result) => console.info("[WHATSAPP ASSISTANT] run", { conversationId: stored.conversationId, ...result }))
            .catch((error) => console.error("[WHATSAPP ASSISTANT] run_failed", { conversationId: stored.conversationId, error: error instanceof Error ? error.message : String(error) }))),
        });
        for (const message of codReplies) {
          const result = await handleCodConfirmationReply({ businessPhoneNumberId: businessNumberId, fromPhone: String(message.from), payload: String(message.button?.payload) })
            .catch((error) => ({ handled: true, outcome: `failed: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` }));
          console.info("[COD CONFIRMATION] reply", { messageId: message.id, outcome: result.outcome });
        }
        await applyStatusUpdates(change.value as WebhookValue);
        await recordOtpDeliveryStatuses(change.value as WebhookValue);
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
