import {
  SendTemplateMessageInput,
  SendTemplateMessageResult,
  WhatsAppProvider,
  WHATSAPP_PROVIDER_META_CLOUD_API,
} from "./types";

type MetaCloudApiConfig = {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  webhookVerifyToken: string;
  graphVersion: string;
};

type MetaMessageResponse = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
};

function readMetaConfig(): MetaCloudApiConfig {
  return {
    accessToken: String(process.env.WHATSAPP_META_ACCESS_TOKEN || "").trim(),
    phoneNumberId: String(process.env.WHATSAPP_META_PHONE_NUMBER_ID || "").trim(),
    businessAccountId: String(process.env.WHATSAPP_META_BUSINESS_ACCOUNT_ID || "").trim(),
    webhookVerifyToken: String(process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN || "").trim(),
    graphVersion: String(process.env.WHATSAPP_META_GRAPH_VERSION || "v20.0").trim(),
  };
}

function assertSendConfig(config: MetaCloudApiConfig) {
  if (!config.accessToken || !config.phoneNumberId) {
    throw new Error("Meta WhatsApp Cloud API send config is missing");
  }
}

function graphMessagesUrl(config: MetaCloudApiConfig) {
  const version = config.graphVersion.replace(/^\/+|\/+$/g, "");
  return `https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`;
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
    logMetaEvent("meta_template_send_attempt", input, {
      hasPhoneNumberId: Boolean(config.phoneNumberId),
      graphVersion: config.graphVersion,
    });

    try {
      assertSendConfig(config);
      const components = buildTemplateComponents(input);
      const response = await fetch(graphMessagesUrl(config), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.toPhone,
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
