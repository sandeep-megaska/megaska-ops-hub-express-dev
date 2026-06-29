import { MetaCloudApiWhatsAppProvider } from "./meta-cloud-api";
import { SendTemplateMessageInput, SendTemplateMessageResult, WhatsAppProvider } from "./types";

export type {
  SendTemplateMessageInput,
  SendTemplateMessageResult,
  WhatsAppProvider,
  WhatsAppProviderName,
  WhatsAppTemplateComponent,
  WhatsAppTemplateComponentParameter,
} from "./types";
export { MetaCloudApiWhatsAppProvider, verifyMetaWebhookChallenge } from "./meta-cloud-api";
export { WHATSAPP_PROVIDER_META_CLOUD_API } from "./types";

export function getWhatsAppProvider(): WhatsAppProvider {
  return new MetaCloudApiWhatsAppProvider();
}

export async function sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult> {
  return getWhatsAppProvider().sendTemplateMessage(input);
}

export { dispatchRecoveryMessage, RECOVERY_TEMPLATES } from "./recovery-dispatch";
export type { RecoveryDispatchCandidate } from "./recovery-dispatch";
