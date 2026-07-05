import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { withCors, handleOptions } from "../../_lib/cors";
import {
  getOtpProviderFallbackOrder,
  normalizeIndianPhone,
  OtpProvider,
  sendOtpWithMsg91,
  sendOtpWithTwilio,
} from "../../../../services/auth/otp";
import {
  ShopResolutionError,
  requireStorefrontShopFromRequest,
} from "../../../../services/shopify/shop";

function generateOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

async function createMockChallenge(
  shopId: string,
  phoneE164: string,
  expiresAt: Date
) {
  const otp = generateOtp();

  const challenge = await prisma.oTPChallenge.create({
    data: {
      shopId,
      phoneE164,
      provider: "mock",
      status: "pending",
      attemptsCount: 0,
      expiresAt,
      metadata: {
        otp,
        mode: "mock",
      },
    },
  });

  console.info("[OTP REQUEST SEND SUCCESS]", {
    challengeId: challenge.id,
    shopId,
    phonePresent: Boolean(phoneE164),
    provider: "mock",
  });

  console.log("[OTP REQUEST CREATED MOCK OTP]", {
    challengeId: challenge.id,
    shopId,
    phonePresent: Boolean(phoneE164),
    provider: "mock",
    otpPresent: Boolean(otp),
  });

  return NextResponse.json(
    {
      ok: true,
      sent: true,
      success: true,
      otpSent: true,
      challengeId: challenge.id,
      mock: true,
      provider: "mock",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

async function createProviderChallenge(
  shopId: string,
  phoneE164: string,
  provider: Exclude<OtpProvider, "mock">,
  expiresAt: Date
) {
  if (provider === "twilio") {
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
      phonePresent: Boolean(phoneE164),
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

  const msg91Verification = await sendOtpWithMsg91(phoneE164);

  const challenge = await prisma.oTPChallenge.create({
    data: {
      shopId,
      phoneE164,
      provider,
      providerSid: null,
      status: "pending",
      attemptsCount: 0,
      expiresAt,
      metadata: {
        mode: "msg91",
        msg91Status: msg91Verification.status,
      },
    },
  });

  console.info("[OTP REQUEST SEND SUCCESS]", {
    challengeId: challenge.id,
    shopId,
    phonePresent: Boolean(phoneE164),
    provider,
    providerStatus: msg91Verification.status,
  });

  return NextResponse.json(
    {
      ok: true,
      sent: true,
      success: true,
      otpSent: true,
      challengeId: challenge.id,
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
    const source = String(body?.source ?? "").trim();
    const authHeader = req.headers.get("authorization") || "";
    const tokenParam = req.nextUrl.searchParams.get("token") || "";

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
    const providerOrder = getOtpProviderFallbackOrder();

    console.info("[OTP REQUEST PROVIDER ORDER]", {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      endpointUrl: req.nextUrl.pathname,
      source: source || null,
      hasSessionToken: Boolean(authHeader || tokenParam),
      hasCustomerToken: Boolean(authHeader || tokenParam),
      phonePresent: Boolean(phoneE164),
      providerOrder,
    });

    const failures: Array<{ provider: OtpProvider; message: string }> = [];

    for (const provider of providerOrder) {
      console.info("[OTP REQUEST ATTEMPT]", {
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        provider,
        endpointUrl: req.nextUrl.pathname,
        source: source || null,
        hasSessionToken: Boolean(authHeader || tokenParam),
        hasCustomerToken: Boolean(authHeader || tokenParam),
        phonePresent: Boolean(phoneE164),
      });

      try {
        const response =
          provider === "mock"
            ? await createMockChallenge(shop.id, phoneE164, expiresAt)
            : await createProviderChallenge(
                shop.id,
                phoneE164,
                provider,
                expiresAt
              );

        return withCors(req, response);
      } catch (providerError) {
        const message =
          providerError instanceof Error
            ? providerError.message
            : "Provider send failed";

        failures.push({ provider, message });

        console.warn("[OTP REQUEST SEND FAILURE]", {
          shopId: shop.id,
          shopDomain: shop.shopDomain,
          provider,
          endpointUrl: req.nextUrl.pathname,
          source: source || null,
          status: 503,
          phonePresent: Boolean(phoneE164),
          errorMessage: message,
        });
      }
    }

    console.error("[OTP REQUEST ALL PROVIDERS FAILED]", {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      endpointUrl: req.nextUrl.pathname,
      source: source || null,
      status: 503,
      phonePresent: Boolean(phoneE164),
      failures,
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
