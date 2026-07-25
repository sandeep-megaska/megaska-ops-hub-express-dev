import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { hashSessionToken } from "../../../../../services/auth/session";
import { withCors, handleOptions } from "../../../_lib/cors";
import { findShopifyCustomersByPhone } from "../../../../../services/shopify/admin";
import {
  ShopResolutionError,
  requireShopFromRequest,
} from "../../../../../services/shopify/shop";
import { createEmailVerificationChallenge } from "../../../../../services/customers/email-verification";
import { sendEmailVerificationCode } from "../../../../../services/notifications/resend";

function normalizeEmail(emailRaw: string) {
  return emailRaw.trim().toLowerCase();
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const shop = await requireShopFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(String(body?.email ?? ""));

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailPattern.test(email)) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: "Valid email is required" },
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

    if (!customer.phoneE164) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: "No verified phone on this session" },
          { status: 400 }
        )
      );
    }

    const candidates = await findShopifyCustomersByPhone(customer.phoneE164, {
      shopDomain: shop.shopDomain,
    });

    const matchedCandidate = candidates.find((candidate) => candidate.email === email);

    if (!matchedCandidate) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: "EMAIL_NOT_FOUND" },
          { status: 404 }
        )
      );
    }

    const result = await createEmailVerificationChallenge({
      shopId: shop.id,
      customerProfileId: customer.id,
      email,
      candidateShopifyCustomerId: matchedCandidate.shopifyCustomerId,
    });

    if (result.created) {
      const sendResult = await sendEmailVerificationCode({
        shopId: shop.id,
        to: email,
        code: result.code,
      });

      // A "skipped" transport still means the customer never receives a code — never report success.
      if (sendResult.skipped || !sendResult.success) {
        console.error("[EMAIL VERIFY REQUEST] send failed", { shopId: shop.id, result: sendResult });
        return withCors(
          req,
          NextResponse.json(
            { success: false, error: "Unable to send verification email right now" },
            { status: 502 }
          )
        );
      }
    }

    return withCors(req, NextResponse.json({ success: true }));
  } catch (error) {
    console.error("[EMAIL VERIFY REQUEST ERROR]", error);

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
