import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { hashSessionToken } from "../../../../services/auth/session";
import { prisma } from "../../../../services/db/prisma";
import { parseAmountToMinorUnits } from "../../../../services/wallet";
import { createWalletReservation } from "../../../../services/wallet-reservation";
import {
  ShopResolutionError,
  requireShopFromRequest,
} from "../../../../services/shopify/shop";
import {
  isShopifyStorefrontConfigured,
  resolveCartId,
  updateCartAttributes,
  updateCartBuyerIdentity,
} from "../../../../services/shopify/storefront";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const shop = await requireShopFromRequest(req);

    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!bearerToken) {
      return withCors(
        req,
        NextResponse.json({ ok: false, error: "Session token required" }, { status: 401 })
      );
    }

    const sessionTokenHash = hashSessionToken(bearerToken);
    const now = new Date();
    const session = await prisma.authSession.findFirst({
      where: {
        sessionTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
        customer: {
          shopId: shop.id,
        },
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

    const body = (await req.json()) as {
      cartId?: string;
      cartToken?: string;
      checkoutUrl?: string;
      walletAmount?: string | number;
    };

    const email = String(session.customer.email || "").trim();
    const phone = String(session.customer.phoneE164 || "").trim();
    const firstName = String(session.customer.firstName || "").trim();
    const lastName = String(session.customer.lastName || "").trim();
    const address1 = String(session.customer.addressLine1 || "").trim();
    const address2 = String(session.customer.addressLine2 || "").trim();
    const city = String(session.customer.city || "").trim();
    const province = String(session.customer.stateProvince || "").trim();
    const zip = String(session.customer.postalCode || "").trim();
    const country = String(session.customer.countryRegion || "").trim();
    const phoneVerifiedAt =
      session.customer.phoneVerifiedAt instanceof Date
        ? session.customer.phoneVerifiedAt.toISOString()
        : "";
    const customerProfileId = String(session.customer.id || "").trim();
    const shopifyCustomerId = String(session.customer.shopifyCustomerId || "").trim();
    const resolvedCartId = resolveCartId({
      cartId: body?.cartId,
      cartToken: body?.cartToken,
    });

    const requestedWalletAmount = parseAmountToMinorUnits(body?.walletAmount || "");
    let walletReservation: {
      reservationId: string;
      amountMinor: number;
      currency: string;
      discountCode: string;
      discountNodeId: string;
      expiresAt: Date;
    } | null = null;

    const cartSource = String(body?.cartId || "").trim()
      ? "body.cartId"
      : String(body?.cartToken || "").trim()
        ? "body.cartToken"
        : "none";

    console.log("[Megaska Checkout Prefill] resolved active cart", {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      cartId: resolvedCartId || null,
      cartSource,
      cartIdProvided: Boolean(String(body?.cartId || "").trim()),
      cartTokenProvided: Boolean(String(body?.cartToken || "").trim()),
      checkoutUrl: String(body?.checkoutUrl || "").trim() || null,
    });

    if (!isShopifyStorefrontConfigured()) {
      console.warn("[Megaska Buyer Identity] skipped - storefront api not configured");
      return withCors(
        req,
        NextResponse.json({
          ok: false,
          skipped: true,
          reason: "storefront-not-configured",
          cartId: resolvedCartId || null,
        })
      );
    }

    if (!resolvedCartId) {
      return withCors(
        req,
        NextResponse.json({
          ok: false,
          skipped: true,
          reason: "missing-cart-id",
          cartId: null,
        })
      );
    }

    if (!phone) {
      console.warn("[Megaska Checkout Gate] blocked - missing verified phone on session", {
        shopId: shop.id,
        customerProfileId: customerProfileId || null,
        cartId: resolvedCartId,
      });
      return withCors(
        req,
        NextResponse.json(
          {
            ok: false,
            blocked: true,
            reason: "missing-verified-phone",
            cartId: resolvedCartId,
          },
          { status: 403 }
        )
      );
    }

    const hasBuyerIdentity = Boolean(email || phone);
    if (!hasBuyerIdentity) {
      return withCors(
        req,
        NextResponse.json({
          ok: true,
          skipped: true,
          reason: "missing-profile-contact",
          cartId: resolvedCartId,
        })
      );
    }

    console.log("[Megaska Checkout Prefill] mutation context", {
  shopId: shop.id,
  shopDomain: shop.shopDomain,
  sessionCustomerShopId: session.customer.shopId,
  email,
  phone,
  firstName,
  lastName,
  city,
  province,
  zip,
  country,
  resolvedCartId,
});
console.log("[Megaska Checkout Prefill] email debug", {
  shopId: shop.id,
  shopDomain: shop.shopDomain,
  customerProfileId: session.customer.id,
  emailRaw: session.customer.email,
  emailTrimmed: String(session.customer.email || "").trim(),
  phone: session.customer.phoneE164,
});
    const updateResult = await updateCartBuyerIdentity({
      cartId: resolvedCartId,
      buyerIdentity: {
        email,
        phone,
        firstName,
        lastName,
        address1,
        address2,
        city,
        province,
        zip,
        country,
      },
      shopDomain: shop.shopDomain,
    });

    const verificationAttributes = [
      { key: "megaska_phone_verified", value: "true" },
      { key: "megaska_verified_phone", value: phone },
      { key: "megaska_auth_source", value: "otp" },
      { key: "megaska_customer_profile_id", value: customerProfileId },
      { key: "megaska_shopify_customer_id", value: shopifyCustomerId },
      { key: "megaska_auth_verified_at", value: phoneVerifiedAt },
      { key: "megaska_shop_id", value: shop.id },
      { key: "megaska_shop_domain", value: shop.shopDomain },
    ].filter((entry) => entry.value);

    if (requestedWalletAmount > 0) {
      walletReservation = await createWalletReservation({
        customerProfileId,
        cartId: resolvedCartId,
        amountMinor: requestedWalletAmount,
        sourceFlow: "CHECKOUT",
        sessionReference: session.id,
      });
    }
    console.log("[Megaska Buyer Identity] email result", {
  sentEmail: email,
  returnedEmail: updateResult.buyerIdentity?.email || null,
  userErrors: updateResult.userErrors,
  apiErrors: updateResult.apiErrors,
});

    const walletAttributes = walletReservation
      ? [
          { key: "megaska_wallet_reservation_id", value: walletReservation.reservationId },
          { key: "megaska_wallet_discount_code", value: walletReservation.discountCode },
          { key: "megaska_wallet_reserved_amount", value: String(walletReservation.amountMinor) },
          { key: "megaska_wallet_currency", value: walletReservation.currency },
          { key: "megaska_wallet_reservation_expires_at", value: walletReservation.expiresAt.toISOString() },
        ]
      : [];

    const attributeResult = await updateCartAttributes({
      cartId: resolvedCartId,
      attributes: [...verificationAttributes, ...walletAttributes],shopDomain: shop.shopDomain,
    });

    console.log("[Megaska Buyer Identity] update completed", {
      shopId: shop.id,
      targetCartId: resolvedCartId,
      resultCartId: updateResult.cartId || null,
      resultBuyerIdentity: updateResult.buyerIdentity || null,
      ok: updateResult.ok,
      userErrors: updateResult.userErrors,
      apiErrors: updateResult.apiErrors.map((err) => err.message || "unknown"),
      checkoutUrlReturned: Boolean(updateResult.checkoutUrl),
    });

    console.log("[Megaska Verified Phone] cart verification metadata applied", {
      shopId: shop.id,
      cartId: attributeResult.cartId || resolvedCartId,
      ok: attributeResult.ok,
      keysWritten: [...verificationAttributes, ...walletAttributes].map((item) => item.key),
      trustedPhoneSource: "cart.attribute.megaska_verified_phone",
      userErrors: attributeResult.userErrors,
      apiErrors: attributeResult.apiErrors.map((err) => err.message || "unknown"),
    });

    console.log("[Megaska Checkout Validation] expected function target", {
      functionTarget: "cart.validations.generate.run",
      trustedPhoneAttributeKey: "megaska_verified_phone",
      trustedPhoneVerifiedFlagKey: "megaska_phone_verified",
      note: "Activate the Megaska checkout validation rule in Shopify Admin > Settings > Checkout > Checkout rules.",
    });

    return withCors(
      req,
      NextResponse.json({
        ok: updateResult.ok && attributeResult.ok,
        cartId: attributeResult.cartId || updateResult.cartId || resolvedCartId,
        checkoutUrl:
          attributeResult.checkoutUrl || updateResult.checkoutUrl || body?.checkoutUrl || null,
        buyerIdentity: updateResult.buyerIdentity || null,
        userErrors: [...updateResult.userErrors, ...attributeResult.userErrors],
        apiErrors: [...updateResult.apiErrors, ...attributeResult.apiErrors],
        wallet: walletReservation
          ? {
              applied: true,
              reservationId: walletReservation.reservationId,
              amount: walletReservation.amountMinor,
              currency: walletReservation.currency,
              code: walletReservation.discountCode,
              discountNodeId: walletReservation.discountNodeId,
              expiresAt: walletReservation.expiresAt.toISOString(),
            }
          : { applied: false },
      })
    );
  } catch (error) {
    console.error("[Megaska Checkout Prefill] failed", error);

    const status =
      error instanceof ShopResolutionError ? error.status : 500;

    return withCors(
      req,
      NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Internal error",
        },
        { status }
      )
    );
  }
}
