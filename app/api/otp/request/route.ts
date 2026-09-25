import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { withCors, handleOptions } from "../../_lib/cors";
import { sendOtpWithTwilio } from "../../../../services/auth/otp";
import {
  WHATSAPP_OTP_MAX_PER_WINDOW,
  WHATSAPP_OTP_PROVIDER,
  WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS,
  WHATSAPP_OTP_WINDOW_MINUTES,
  generateWhatsAppOtpCode,
  hashWhatsAppOtpCode,
  isWhatsAppOtpEligible,
  sendOtpWithWhatsApp,
} from "../../../../services/auth/whatsapp-otp";
import {
  OtpPhonePolicyError,
  resolveOtpPhoneForShop,
} from "../../../../services/auth/otp-phone-policy";
import { resolveOtpProviderForShop } from "../../../../services/auth/otp-provider-resolver";
import { recordAcceptedOtpRequestUsage } from "../../../../services/usage/otp-usage";
import crypto from "node:crypto";
import {
  ShopResolutionError,
  requireStorefrontShopFromRequest,
} from "../../../../services/shopify/shop";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

async function createProviderChallenge(
  shopId: string,
  phoneE164: string,
  provider: "twilio",
  expiresAt: Date
) {
  const twilioVerification = await sendOtpWithTwilio(phoneE164);

  const challenge = await prisma.oTPChallenge.create({
    data: {
      shopId,
      phoneE164,
      provider,
      providerSid: twilioVerification.sid,
      status: "pending",
      attemptsCount: 0,
      expiresAt,
      metadata: {
        mode: "twilio",
        twilioStatus: twilioVerification.status,
      },
    },
  });

  if (!twilioVerification.sid) {
    console.warn("[USAGE METER]", {
      operation: "otp_usage_provider_reference_missing",
      shopId,
      sourceType: "OTP_CHALLENGE",
      sourceId: challenge.id,
      provider: "PLATFORM_TWILIO",
    });
  }

  try {
    await recordAcceptedOtpRequestUsage({
      shopId,
      challengeId: challenge.id,
      provider: "PLATFORM_TWILIO",
      providerSid: twilioVerification.sid ?? null,
      phoneE164,
    });
  } catch (error) {
    console.error("[USAGE METER]", {
      operation: "otp_usage_record_failed",
      shopId,
      sourceType: "OTP_CHALLENGE",
      sourceId: challenge.id,
      provider: "PLATFORM_TWILIO",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }

  console.info("[OTP REQUEST SEND SUCCESS]", {
    challengeId: challenge.id,
    shopId,
    provider,
    providerStatus: twilioVerification.status,
  });

  return NextResponse.json(
    {
      ok: true,
      sent: true,
      success: true,
      otpSent: true,
      challengeId: challenge.id,
      phone: phoneE164,
      provider,
      channel: "sms",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

// Our own limits: Twilio Verify rate-limits its sends, but WhatsApp codes are
// issued by us, so repeated requests must be throttled here.
async function getWhatsAppOtpRateLimit(shopId: string, phoneE164: string) {
  const now = Date.now();
  const recent = await prisma.oTPChallenge.findMany({
    where: {
      shopId,
      phoneE164,
      provider: WHATSAPP_OTP_PROVIDER,
      createdAt: { gt: new Date(now - WHATSAPP_OTP_WINDOW_MINUTES * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
    take: WHATSAPP_OTP_MAX_PER_WINDOW,
  });

  if (recent.length >= WHATSAPP_OTP_MAX_PER_WINDOW) {
    const oldest = recent[recent.length - 1].createdAt.getTime();
    return Math.max(1, Math.ceil((oldest + WHATSAPP_OTP_WINDOW_MINUTES * 60 * 1000 - now) / 1000));
  }

  const latest = recent[0]?.createdAt.getTime();
  if (latest && now - latest < WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS * 1000) {
    return Math.max(1, Math.ceil((latest + WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000));
  }

  return 0;
}

async function createWhatsAppChallenge(
  shopId: string,
  phoneE164: string,
  expiresAt: Date,
  smsFallbackAvailable: boolean
) {
  const challengeId = crypto.randomUUID();
  const code = generateWhatsAppOtpCode();

  // Only the newest code is valid: otherwise an exhausted challenge would let
  // verification fall back to an older pending one for fresh guesses.
  await prisma.oTPChallenge.updateMany({
    where: { shopId, phoneE164, status: "pending" },
    data: { status: "superseded" },
  });

  // Persist before sending so a delivered code is always verifiable.
  await prisma.oTPChallenge.create({
    data: {
      id: challengeId,
      shopId,
      phoneE164,
      provider: WHATSAPP_OTP_PROVIDER,
      status: "pending",
      attemptsCount: 0,
      expiresAt,
      metadata: {
        mode: WHATSAPP_OTP_PROVIDER,
        codeHash: hashWhatsAppOtpCode(challengeId, code),
      },
    },
  });

  let messageId: string | null;
  try {
    ({ messageId } = await sendOtpWithWhatsApp(phoneE164, code));
  } catch (error) {
    await prisma.oTPChallenge
      .update({ where: { id: challengeId }, data: { status: "failed" } })
      .catch(() => {});
    throw error;
  }

  await prisma.oTPChallenge
    .update({ where: { id: challengeId }, data: { providerSid: messageId } })
    .catch(() => {});

  try {
    await recordAcceptedOtpRequestUsage({
      shopId,
      challengeId,
      provider: "PLATFORM_WHATSAPP",
      providerSid: messageId,
      phoneE164,
    });
  } catch (error) {
    console.error("[USAGE METER]", {
      operation: "otp_usage_record_failed",
      shopId,
      sourceType: "OTP_CHALLENGE",
      sourceId: challengeId,
      provider: "PLATFORM_WHATSAPP",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }

  console.info("[OTP REQUEST SEND SUCCESS]", {
    challengeId,
    shopId,
    provider: WHATSAPP_OTP_PROVIDER,
    hasMessageId: Boolean(messageId),
  });

  return NextResponse.json(
    {
      ok: true,
      sent: true,
      success: true,
      otpSent: true,
      challengeId,
      phone: phoneE164,
      provider: WHATSAPP_OTP_PROVIDER,
      channel: "whatsapp",
      smsFallbackAvailable,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const shop = await requireStorefrontShopFromRequest(req);

    const body = await req.json();
    const { phoneE164 } = await resolveOtpPhoneForShop({
      shopId: shop.id,
      phone: body?.phone,
      countryCode: body?.countryCode,
    });

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const resolution = await resolveOtpProviderForShop(shop.id);
    const otpBlocked =
      resolution.available === false &&
      (resolution.reason === "OTP_DISABLED" || resolution.reason === "SHOP_UNRESOLVED");

    // WhatsApp first (no DLT, far cheaper than SMS). The shopper can still ask
    // for SMS explicitly (channel: "sms") when the WhatsApp code never arrives.
    const smsRequested = body?.channel === "sms";
    if (!otpBlocked && !smsRequested && isWhatsAppOtpEligible(phoneE164)) {
      const retryAfterSeconds = await getWhatsAppOtpRateLimit(shop.id, phoneE164);
      if (retryAfterSeconds > 0) {
        return withCors(
          req,
          NextResponse.json(
            {
              error: `Please wait ${retryAfterSeconds}s before requesting another code.`,
              code: "OTP_RATE_LIMITED",
              retryAfterSeconds,
            },
            { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
          )
        );
      }

      try {
        const response = await createWhatsAppChallenge(
          shop.id,
          phoneE164,
          expiresAt,
          resolution.available
        );
        return withCors(req, response);
      } catch (whatsAppError) {
        console.warn("[OTP REQUEST WHATSAPP FALLBACK]", {
          shopId: shop.id,
          shopDomain: shop.shopDomain,
          smsFallbackAvailable: resolution.available,
          message: whatsAppError instanceof Error ? whatsAppError.message : "WhatsApp send failed",
        });
      }
    }

    if (resolution.available === false) {
      console.warn("[OTP REQUEST PROVIDER UNAVAILABLE]", {
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        reason: resolution.reason,
      });

      return withCors(
        req,
        NextResponse.json(
          {
            error: "OTP service is temporarily unavailable. Please try again shortly.",
          },
          { status: 503 }
        )
      );
    }

    console.info("[OTP REQUEST PROVIDER RESOLVED]", {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      provider: resolution.provider,
      transportProvider: resolution.transportProvider,
      usedFallback: resolution.usedFallback,
    });

    try {
      const response = await createProviderChallenge(
        shop.id,
        phoneE164,
        resolution.transportProvider,
        expiresAt
      );

      return withCors(req, response);
    } catch (providerError) {
      const message =
        providerError instanceof Error
          ? providerError.message
          : "Provider send failed";

      console.warn("[OTP REQUEST SEND FAILURE]", {
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        provider: resolution.provider,
        transportProvider: resolution.transportProvider,
        message,
      });

      return withCors(
        req,
        NextResponse.json(
          {
            error: "Unable to send OTP right now. Please try again shortly.",
          },
          { status: 503 }
        )
      );
    }
  } catch (error) {
    if (error instanceof OtpPhonePolicyError) {
      return withCors(
        req,
        NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status },
        ),
      );
    }
    console.error("[OTP REQUEST ERROR]", error);

    const status =
      error instanceof ShopResolutionError ? error.status : 500;

    return withCors(
      req,
      NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Internal error",
        },
        { status }
      )
    );
  }
}
