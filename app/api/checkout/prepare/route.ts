import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { prisma } from "../../../../services/db/prisma";
import { hashSessionToken, getSessionTokenFromRequest } from "../../../../services/auth/session";
import {
  resolveCartId,
  updateCartAttributes,
  updateCartBuyerIdentity,
} from "../../../../services/shopify/storefront";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const sessionToken = getSessionTokenFromRequest(req);

    if (!sessionToken) {
      return withCors(
        req,
        NextResponse.json({ ok: false, error: "Session token required" }, { status: 401 })
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      cartId?: string;
      cartToken?: string;
    };

    const cartId = resolveCartId({
      cartId: body.cartId,
      cartToken: body.cartToken,
    });

    if (!cartId) {
      return withCors(
        req,
        NextResponse.json({ ok: false, error: "cartId/cartToken required" }, { status: 400 })
      );
    }

    const now = new Date();

    const session = await prisma.authSession.findFirst({
      where: {
        sessionTokenHash: hashSessionToken(sessionToken),
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        customer: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!session?.customer) {
      return withCors(
        req,
        NextResponse.json({ ok: false, error: "Invalid or expired session" }, { status: 401 })
      );
    }

    const customer = session.customer;
    const customerProfileId = String(customer.id || "").trim();
    const shopifyCustomerId = String(customer.shopifyCustomerId || "").trim();
    const phone = String(customer.phoneE164 || "").trim();
    const phoneVerifiedAt =
      customer.phoneVerifiedAt instanceof Date
        ? customer.phoneVerifiedAt.toISOString()
        : "";

    if (!phone) {
      return withCors(
        req,
        NextResponse.json(
          { ok: false, blocked: true, reason: "missing-verified-phone" },
          { status: 403 }
        )
      );
    }

    const identityResult = await updateCartBuyerIdentity({
      cartId,
      buyerIdentity: {
        email: customer.email || undefined,
        phone: customer.phoneE164 || undefined,
        firstName: customer.firstName || undefined,
        lastName: customer.lastName || undefined,
        address1: customer.addressLine1 || undefined,
        address2: customer.addressLine2 || undefined,
        city: customer.city || undefined,
        province: customer.stateProvince || undefined,
        zip: customer.postalCode || undefined,
        country: customer.countryRegion || undefined,
      },
    });

    const verificationAttributes = [
      { key: "megaska_phone_verified", value: "true" },
      { key: "megaska_verified_phone", value: phone },
      { key: "megaska_auth_source", value: "otp" },
      { key: "megaska_customer_profile_id", value: customerProfileId },
      { key: "megaska_shopify_customer_id", value: shopifyCustomerId },
      { key: "megaska_auth_verified_at", value: phoneVerifiedAt },
    ].filter((entry) => entry.value);

    const attributeResult = await updateCartAttributes({
      cartId,
      attributes: verificationAttributes,
    });

    const ok = Boolean(identityResult.ok && attributeResult.ok);
    const checkoutUrl =
      attributeResult.checkoutUrl ||
      identityResult.checkoutUrl ||
      "/checkout";

    return withCors(
      req,
      NextResponse.json({
        ok,
        blocked: false,
        cartId: attributeResult.cartId || identityResult.cartId || cartId,
        checkoutUrl,
        redirectUrl: checkoutUrl,
        buyerIdentity: identityResult.buyerIdentity || null,
        userErrors: [
          ...(identityResult.userErrors || []),
          ...(attributeResult.userErrors || []),
        ],
        apiErrors: [
          ...(identityResult.apiErrors || []),
          ...(attributeResult.apiErrors || []),
        ],
      })
    );
  } catch (error) {
    return withCors(
      req,
      NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Failed",
        },
        { status: 500 }
      )
    );
  }
}
