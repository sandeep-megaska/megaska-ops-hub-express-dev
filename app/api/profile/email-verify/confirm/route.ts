import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { hashSessionToken } from "../../../../../services/auth/session";
import { withCors, handleOptions } from "../../../_lib/cors";
import {
  ShopResolutionError,
  requireShopFromRequest,
} from "../../../../../services/shopify/shop";
import { verifyEmailVerificationChallenge } from "../../../../../services/customers/email-verification";
import { CanonicalCustomerResolver } from "../../../../../services/customers/canonical-customer-resolver";

function normalizeEmail(emailRaw: string) {
  return emailRaw.trim().toLowerCase();
}

const VERIFY_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: "No verification in progress for this email. Request a new code.",
  EXPIRED: "This code has expired. Request a new one.",
  TOO_MANY_ATTEMPTS: "Too many incorrect attempts. Request a new code.",
  INCORRECT_CODE: "Incorrect code. Please try again.",
  IDENTITY_CONFLICT: "We couldn't confirm this account. Please contact support.",
};

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const shop = await requireShopFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(String(body?.email ?? ""));
    const code = String(body?.code ?? "").trim();

    if (!email || !code) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: "Email and code are required" },
          { status: 400 }
        )
      );
    }

    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!bearerToken) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: "Session token required" },
          { status: 401 }
        )
      );
    }

    const now = new Date();
    const sessionTokenHash = hashSessionToken(bearerToken);

    const session = await prisma.authSession.findFirst({
      where: {
        sessionTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
        customer: { shopId: shop.id },
      },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    });

    if (!session) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: "Invalid or expired session" },
          { status: 401 }
        )
      );
    }

    const customer = session.customer;

    const result = await verifyEmailVerificationChallenge({
      shopId: shop.id,
      customerProfileId: customer.id,
      email,
      code,
    });

    if (!result.ok) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: VERIFY_ERROR_MESSAGES[result.reason] || "Verification failed" },
          { status: 400 }
        )
      );
    }

    const identity = await new CanonicalCustomerResolver().resolveFromCheckout({
      shopId: shop.id,
      shopifyCustomerId: result.candidateShopifyCustomerId,
      phoneE164: customer.phoneE164,
      phoneVerified: Boolean(customer.phoneVerifiedAt),
      email: result.email,
      emailVerified: true,
      customerAttributes: {
        firstName: result.candidateFirstName || undefined,
        lastName: result.candidateLastName || undefined,
        fullName:
          [result.candidateFirstName, result.candidateLastName].filter(Boolean).join(" ") || undefined,
      },
    });

    if (!identity.customerProfile || identity.customerProfile.id !== customer.id) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: VERIFY_ERROR_MESSAGES.IDENTITY_CONFLICT },
          { status: 409 }
        )
      );
    }

    const updatedCustomer = await prisma.customerProfile.update({
      where: { id: customer.id },
      data: { profileCompletedAt: now },
    });

    return withCors(
      req,
      NextResponse.json({
        success: true,
        customer: {
          id: updatedCustomer.id,
          phoneE164: updatedCustomer.phoneE164,
          fullName: updatedCustomer.fullName,
          firstName: updatedCustomer.firstName,
          lastName: updatedCustomer.lastName,
          email: updatedCustomer.email,
          shopifyCustomerId: updatedCustomer.shopifyCustomerId,
        },
      })
    );
  } catch (error) {
    console.error("[EMAIL VERIFY CONFIRM ERROR]", error);

    const status = error instanceof ShopResolutionError ? error.status : 500;

    return withCors(
      req,
      NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Internal error",
        },
        { status }
      )
    );
  }
}
