import type { SendTemplateMessageInput, SendTemplateMessageResult, WhatsAppProvider } from "./types.ts";
import { WHATSAPP_PROVIDER_META_CLOUD_API } from "./types.ts";

type MetaCloudApiConfig = {
  webhookVerifyToken: string;
  graphVersion: string;
};

type MetaMessageResponse = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
};

function readMetaConfig(): MetaCloudApiConfig {
  return {
    webhookVerifyToken: String(process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN || "").trim(),
    graphVersion: String(process.env.WHATSAPP_META_GRAPH_VERSION || "v20.0").trim(),
  };
}

function graphMessagesUrl(config: MetaCloudApiConfig, phoneNumberId: string) {
  const version = config.graphVersion.replace(/^\/+|\/+$/g, "");
  return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
}

function buildTemplateComponents(input: SendTemplateMessageInput) {
  if (input.components?.length) return input.components;
  if (!input.variables?.length) return undefined;

  return [
    {
      type: "body",
      parameters: input.variables.map((text) => ({ type: "text", text })),
    },
  ];
}

function logMetaEvent(event: string, input: SendTemplateMessageInput, extra: Record<string, unknown> = {}) {
  console.log(`[WHATSAPP] ${event}`, {
    provider: WHATSAPP_PROVIDER_META_CLOUD_API,
    shopId: input.shopId,
    templateName: input.templateName,
    languageCode: input.languageCode,
    recoveryType: input.recoveryType || null,
    checkoutIntentId: input.checkoutIntentId || null,
    ...extra,
  });
}

export class MetaCloudApiWhatsAppProvider implements WhatsAppProvider {
  readonly name = WHATSAPP_PROVIDER_META_CLOUD_API;

  async sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult> {
    const config = readMetaConfig();
    const sender = input.sender;
    logMetaEvent("meta_template_send_attempt", input, {
      hasSender: Boolean(sender?.accessToken && sender?.phoneNumberId),
      graphVersion: config.graphVersion,
    });

    try {
      if (!sender?.accessToken || !sender.phoneNumberId) throw new Error("No WhatsApp sender for this shop");
      const components = buildTemplateComponents(input);
      const response = await fetch(graphMessagesUrl(config, sender.phoneNumberId), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sender.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.toPhone.replace(/^\+/, ""),
          type: "template",
          template: {
            name: input.templateName,
            language: { code: input.languageCode },
            ...(components?.length ? { components } : {}),
          },
        }),
      });

      const data = (await response.json().catch(() => null)) as MetaMessageResponse | null;
      if (!response.ok) {
        throw new Error(data?.error?.message || `Meta WhatsApp Cloud API HTTP ${response.status}`);
      }

      const messageId = data?.messages?.[0]?.id || null;
      logMetaEvent("meta_template_send_success", input, { messageId });
      return { provider: this.name, success: true, messageId };
    } catch (error) {
      logMetaEvent("meta_template_send_failed", input, {
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return { provider: this.name, success: false };
    }
  }
}

export function verifyMetaWebhookChallenge(searchParams: URLSearchParams): string | null {
  const config = readMetaConfig();
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === config.webhookVerifyToken && challenge) {
    return challenge;
  }

  return null;
}
