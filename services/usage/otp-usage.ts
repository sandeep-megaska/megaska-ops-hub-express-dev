import { recordMerchantUsage } from "./merchant-usage.ts";

export function deriveOtpUsageCountryCode(phoneE164?: string | null) {
  return phoneE164?.startsWith("+91") ? "IN" : null;
}

export async function recordAcceptedOtpRequestUsage(input: {
  shopId: string;
  challengeId: string;
  provider: "PLATFORM_TWILIO" | "PLATFORM_WHATSAPP" | "MERCHANT_WHATSAPP";
  providerSid?: string | null;
  phoneE164?: string | null;
  occurredAt?: Date;
}): Promise<void> {
  await recordMerchantUsage({
    shopId: input.shopId,
    usageType: "OTP",
    action: "OTP_REQUEST",
    provider: input.provider,
    quantity: 1,
    sourceType: "OTP_CHALLENGE",
    sourceId: input.challengeId,
    providerReference: input.providerSid ?? null,
    idempotencyKey: `usage:otp-request:${input.shopId}:${input.challengeId}`,
    countryCode: deriveOtpUsageCountryCode(input.phoneE164),
    occurredAt: input.occurredAt,
    metadata: { transportProvider: input.provider === "PLATFORM_TWILIO" ? "twilio" : "whatsapp", providerStatus: "pending", usedFallback: false },
  });
}
