// An SMS OTP challenge through the platform's Twilio Verify service: Twilio sends
// and checks the code, we keep the challenge (providerSid = verification sid)
// and meter the request. Used by the OTP request route and, when Meta reports
// a WhatsApp OTP as undelivered, by the automatic SMS backup
// (services/whatsapp/otp-sms-backup.ts).
import { prisma } from "../db/prisma";
import { sendOtpWithTwilio } from "./otp";
import { recordAcceptedOtpRequestUsage } from "../usage/otp-usage";

export async function createSmsOtpChallenge(input: { shopId: string; phoneE164: string; expiresAt: Date; fallbackFrom?: string | null }) {
  const { shopId, phoneE164, expiresAt } = input;
  const twilioVerification = await sendOtpWithTwilio(phoneE164);

  const challenge = await prisma.oTPChallenge.create({
    data: {
      shopId,
      phoneE164,
      provider: "twilio",
      providerSid: twilioVerification.sid,
      status: "pending",
      attemptsCount: 0,
      expiresAt,
      metadata: {
        mode: "twilio",
        twilioStatus: twilioVerification.status,
        // The WhatsApp challenge this SMS replaced, when it is an automatic backup.
        ...(input.fallbackFrom ? { fallbackFrom: input.fallbackFrom } : {}),
      },
    },
  });

  if (!twilioVerification.sid) {
    console.warn("[USAGE METER]", { operation: "otp_usage_provider_reference_missing", shopId, sourceType: "OTP_CHALLENGE", sourceId: challenge.id, provider: "PLATFORM_TWILIO" });
  }

  try {
    await recordAcceptedOtpRequestUsage({ shopId, challengeId: challenge.id, provider: "PLATFORM_TWILIO", providerSid: twilioVerification.sid ?? null, phoneE164 });
  } catch (error) {
    console.error("[USAGE METER]", { operation: "otp_usage_record_failed", shopId, sourceType: "OTP_CHALLENGE", sourceId: challenge.id, provider: "PLATFORM_TWILIO", errorName: error instanceof Error ? error.name : "UnknownError" });
  }

  return { challengeId: challenge.id, providerStatus: twilioVerification.status };
}
