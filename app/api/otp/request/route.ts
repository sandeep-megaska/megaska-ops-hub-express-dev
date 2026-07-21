import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { withCors, handleOptions } from "../../_lib/cors";
import { sendOtpWithTwilio } from "../../../../services/auth/otp";
import {
  OtpPhonePolicyError,
  resolveOtpPhoneForShop,
} from "../../../../services/auth/otp-phone-policy";
import { resolveOtpProviderForShop } from "../../../../services/auth/otp-provider-resolver";
import { recordAcceptedOtpRequestUsage } from "../../../../services/usage/otp-usage";
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
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
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
