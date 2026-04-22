import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import {
  generateSessionToken,
  hashSessionToken,
} from "../../../../services/auth/session";
import { withCors, handleOptions } from "../../_lib/cors";
import {
  normalizeIndianPhone,
  verifyOtpWithMsg91,
  verifyOtpWithTwilio,
} from "../../../../services/auth/otp";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const phoneRaw = String(body?.phone ?? "").trim();
    const otpRaw = String(body?.otp ?? "").trim();

    if (!phoneRaw) {
      return withCors(
        req,
        NextResponse.json({ error: "Phone required" }, { status: 400 })
      );
    }

    if (!otpRaw) {
      return withCors(
        req,
        NextResponse.json({ error: "OTP required" }, { status: 400 })
      );
    }

    const phoneE164 = normalizeIndianPhone(phoneRaw);

    if (!phoneE164) {
      return withCors(
        req,
        NextResponse.json({ error: "Invalid phone format" }, { status: 400 })
      );
    }

    const challenge = await prisma.oTPChallenge.findFirst({
      where: {
        phoneE164,
        status: "pending",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!challenge) {
      return withCors(
        req,
        NextResponse.json(
          { error: "No pending OTP challenge found" },
          { status: 404 }
        )
      );
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      await prisma.oTPChallenge.update({
        where: { id: challenge.id },
        data: { status: "expired" },
      });

      return withCors(
        req,
        NextResponse.json({ error: "OTP expired" }, { status: 400 })
      );
    }

    const provider = challenge.provider;

    console.info("[OTP VERIFY PROVIDER SELECTED]", {
      challengeId: challenge.id,
      provider,
      phoneE164,
    });

    if (provider === "twilio") {
      try {
        const check = await verifyOtpWithTwilio(phoneE164, otpRaw);

        console.info("[OTP VERIFY TWILIO RESULT]", {
          challengeId: challenge.id,
          phoneE164,
          provider,
          status: check.status,
          valid: check.valid,
        });

        if (!check.valid) {
          await prisma.oTPChallenge.update({
            where: { id: challenge.id },
            data: {
              attemptsCount: { increment: 1 },
              metadata: {
                mode: "twilio",
                twilioStatus: check.status,
              },
            },
          });

          return withCors(
            req,
            NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 })
          );
        }
      } catch (twilioError) {
        console.error("[OTP VERIFY TWILIO FAILURE]", {
          challengeId: challenge.id,
          phoneE164,
          provider,
          message:
            twilioError instanceof Error
              ? twilioError.message
              : "Twilio verification failed",
        });

        return withCors(
          req,
          NextResponse.json(
            { error: "Unable to verify OTP right now. Please retry." },
            { status: 503 }
          )
        );
      }
    } else if (provider === "msg91") {
      try {
        const check = await verifyOtpWithMsg91(phoneE164, otpRaw);

        console.info("[OTP VERIFY MSG91 RESULT]", {
          challengeId: challenge.id,
          phoneE164,
          provider,
          status: check.status,
          valid: check.valid,
        });

        const approved = check.valid && check.status === "approved";

        if (!approved) {
          await prisma.oTPChallenge.update({
            where: { id: challenge.id },
            data: {
              attemptsCount: { increment: 1 },
              metadata: {
                mode: "msg91",
                msg91Status: check.status,
              },
            },
          });

          return withCors(
            req,
            NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 })
          );
        }
      } catch (msg91Error) {
        console.error("[OTP VERIFY MSG91 FAILURE]", {
          challengeId: challenge.id,
          phoneE164,
          provider,
          message:
            msg91Error instanceof Error
              ? msg91Error.message
              : "MSG91 verification failed",
        });

        return withCors(
          req,
          NextResponse.json(
            { error: "Unable to verify OTP right now. Please retry." },
            { status: 503 }
          )
        );
      }
    } else {
      const metadata =
        challenge.metadata && typeof challenge.metadata === "object"
          ? (challenge.metadata as Record<string, unknown>)
          : {};

      const storedOtp = String(metadata.otp ?? "");

      if (storedOtp !== otpRaw) {
        await prisma.oTPChallenge.update({
          where: { id: challenge.id },
          data: {
            attemptsCount: { increment: 1 },
          },
        });

        return withCors(
          req,
          NextResponse.json({ error: "Invalid OTP" }, { status: 400 })
        );
      }

      console.log("[OTP VERIFY MOCK RESULT]", {
        challengeId: challenge.id,
        phoneE164,
        provider: "mock",
        status: "approved",
      });
    }

    const now = new Date();

    const verifiedChallenge = await prisma.oTPChallenge.update({
      where: { id: challenge.id },
      data: {
        status: "verified",
        verifiedAt: now,
      },
    });

    let customerProfile = await prisma.customerProfile.findFirst({
  where: {
    phoneE164,
  },
  orderBy: {
    createdAt: "desc",
  },
});
    if (!customerProfile) {
      customerProfile = await prisma.customerProfile.create({
        data: {
          phoneE164,
          phoneVerifiedAt: now,
        },
      });
    } else if (!customerProfile.phoneVerifiedAt) {
      customerProfile = await prisma.customerProfile.update({
        where: {
          id: customerProfile.id,
        },
        data: {
          phoneVerifiedAt: now,
        },
      });
    }

    const sessionToken = generateSessionToken();
    const sessionTokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const authSession = await prisma.authSession.create({
      data: {
        customerProfileId: customerProfile.id,
        sessionTokenHash,
        expiresAt,
        lastSeenAt: now,
      },
    });

    return withCors(
      req,
      NextResponse.json({
        success: true,
        verified: true,
        phone: phoneE164,
        customerProfileId: customerProfile.id,
        sessionToken,
        sessionExpiresAt: authSession.expiresAt,
        mock: provider === "mock",
        provider,
        challengeId: verifiedChallenge.id,
        customer: {
          id: customerProfile.id,
          phoneE164: customerProfile.phoneE164,
          fullName: customerProfile.fullName,
          firstName: customerProfile.firstName,
          lastName: customerProfile.lastName,
          email: customerProfile.email,
          addressLine1: customerProfile.addressLine1,
          addressLine2: customerProfile.addressLine2,
          city: customerProfile.city,
          stateProvince: customerProfile.stateProvince,
          postalCode: customerProfile.postalCode,
          countryRegion: customerProfile.countryRegion,
          profileCompletedAt: customerProfile.profileCompletedAt,
          profileComplete: Boolean(
            customerProfile.firstName?.trim() &&
              customerProfile.lastName?.trim() &&
              customerProfile.email?.trim() &&
              customerProfile.addressLine1?.trim() &&
              customerProfile.city?.trim() &&
              customerProfile.stateProvince?.trim() &&
              customerProfile.postalCode?.trim() &&
              customerProfile.countryRegion?.trim()
          ),
        },
      })
    );
  } catch (error) {
    console.error("[OTP VERIFY ERROR]", error);

    return withCors(
      req,
      NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Internal error",
        },
        { status: 500 }
      )
    );
  }
}
