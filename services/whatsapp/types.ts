export const WHATSAPP_PROVIDER_META_CLOUD_API = "META_CLOUD_API" as const;

export type WhatsAppProviderName = typeof WHATSAPP_PROVIDER_META_CLOUD_API;

export type WhatsAppTemplateComponentParameter =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "currency";
      currency: {
        fallback_value: string;
        code: string;
        amount_1000: number;
      };
    }
  | {
      type: "date_time";
      date_time: {
        fallback_value: string;
      };
    }
  | Record<string, unknown>;

export type WhatsAppTemplateComponent = {
  type: "header" | "body" | "button" | string;
  sub_type?: string;
  index?: string;
  parameters?: WhatsAppTemplateComponentParameter[];
};

export type SendTemplateMessageInput = {
  // The number to send from (see sender.ts). Required: there is no global
  // fallback, so one shop's message can never go out from another's number.
  sender: { accessToken: string; phoneNumberId: string } | null;
  toPhone: string;
  templateName: string;
  languageCode: string;
  components?: WhatsAppTemplateComponent[];
  variables?: string[];
  shopId: string;
  recoveryType?: string;
  checkoutIntentId?: string;
};

export type SendTemplateMessageResult = {
  provider: WhatsAppProviderName;
  success: boolean;
  messageId?: string | null;
};

export interface WhatsAppProvider {
  readonly name: WhatsAppProviderName;
  sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult>;
}
