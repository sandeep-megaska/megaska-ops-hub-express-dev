import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { withCors, handleOptions } from "../../_lib/cors";
import {
  normalizeIndianPhone,
  sendOtpWithTwilio,
} from "../../../../services/auth/otp";
import { resolveOtpProviderForShop } from "../../../../services/auth/otp-provider-resolver";
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
    const phoneRaw = String(body?.phone ?? "").trim();

    if (!phoneRaw) {
      return withCors(
        req,
        NextResponse.json({ error: "Phone required" }, { status: 400 })
      );
    }

    const phoneE164 = normalizeIndianPhone(phoneRaw);

    if (!phoneE164) {
      return withCors(
        req,
        NextResponse.json({ error: "Invalid phone format" }, { status: 400 })
      );
    }

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
