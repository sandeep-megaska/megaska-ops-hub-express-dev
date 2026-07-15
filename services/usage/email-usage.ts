import { recordMerchantUsage } from "./merchant-usage.ts";

export type EmailUsageAudience = "ADMIN" | "CUSTOMER";

export async function recordAcceptedEmailUsage(input: {
  shopId: string;
  notificationAudience: EmailUsageAudience;
  eventType: string;
  providerMessageId?: string | null;
  notificationAttemptId: string;
  recipientCount: number;
  sourceType?: string | null;
  sourceId?: string | null;
  idempotencyKey?: string | null;
  occurredAt?: Date;
}, db?: Parameters<typeof recordMerchantUsage>[1]): Promise<{ eventId: string; created: boolean }> {
  const providerMessageId = input.providerMessageId?.trim() || null;
  const notificationAttemptId = input.notificationAttemptId.trim();
  const sourceType = input.sourceType?.trim() || (providerMessageId ? "RESEND_MESSAGE" : "RESEND_ATTEMPT");
  const sourceId = input.sourceId?.trim() || providerMessageId || notificationAttemptId;
  const idempotencyKey = input.idempotencyKey?.trim() || (providerMessageId
    ? `usage:email-send:${input.shopId}:resend:${providerMessageId}`
    : `usage:email-send:${input.shopId}:attempt:${notificationAttemptId}`);

  return recordMerchantUsage({
    shopId: input.shopId,
    usageType: "EMAIL",
    action: "EMAIL_SEND",
    provider: "PLATFORM_RESEND",
    quantity: 1,
    sourceType,
    sourceId,
    providerReference: providerMessageId,
    idempotencyKey,
    occurredAt: input.occurredAt,
    metadata: {
      audience: input.notificationAudience,
      eventType: input.eventType,
      recipientCount: input.recipientCount,
      transport: "resend",
    },
  }, db);
}
