import { MetaCloudApiWhatsAppProvider } from "./meta-cloud-api.ts";
import type { SendTemplateMessageInput, SendTemplateMessageResult, WhatsAppProvider } from "./types.ts";

export type {
  SendTemplateMessageInput,
  SendTemplateMessageResult,
  WhatsAppProvider,
  WhatsAppProviderName,
  WhatsAppTemplateComponent,
  WhatsAppTemplateComponentParameter,
} from "./types.ts";
export { MetaCloudApiWhatsAppProvider, verifyMetaWebhookChallenge } from "./meta-cloud-api.ts";
export { WHATSAPP_PROVIDER_META_CLOUD_API } from "./types.ts";

export function getWhatsAppProvider(): WhatsAppProvider {
  return new MetaCloudApiWhatsAppProvider();
}

export async function sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult> {
  return getWhatsAppProvider().sendTemplateMessage(input);
}

export { dispatchRecoveryMessage, RECOVERY_TEMPLATES } from "./recovery-dispatch.ts";
export type { RecoveryDispatchCandidate } from "./recovery-dispatch.ts";
