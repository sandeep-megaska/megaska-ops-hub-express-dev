import type { NextRequest } from "next/server";
import { prisma } from "../../services/db/prisma";
import { hashSessionToken } from "../../services/auth/session";
import {
  requireStorefrontShopFromRequest,
  ShopResolutionError,
} from "../../services/shopify/shop";
import { EXPRESS_CHECKOUT_NOT_READY, resolveExpressCheckoutReadiness } from "../../services/express-checkout/readiness";

export type ExpressCheckoutSafetyError = {
  status: 401 | 403;
  error: string;
  code?: string;
};

export type ExpressCheckoutShopContext = {
  shopDomain: string;
  shopId: string;
};

type CustomerSessionForShop = NonNullable<Awaited<ReturnType<typeof findCustomerSessionForShop>>>;

export type ExpressCheckoutCustomerSessionContext = {
  customer: CustomerSessionForShop["customer"];
  session: CustomerSessionForShop;
};

// Public SaaS: express checkout is available to any installed shop that has
// completed per-shop readiness (merchant enable toggle + a configured and
// validated Razorpay key), which resolveExpressCheckoutReadiness enforces in
// requireExpressCheckoutShop below. There is no per-shop allowlist.
// EXPRESS_CHECKOUT_ENABLED is retained only as an opt-out emergency kill
// switch: unset — or anything other than the literal "false" — keeps express
// checkout enabled.
function isExpressCheckoutGloballyDisabled() {
  return String(process.env.EXPRESS_CHECKOUT_ENABLED || "").trim().toLowerCase() === "false";
}

async function findCustomerSessionForShop(sessionToken: string, shopId: string) {
  const now = new Date();

  return prisma.authSession.findFirst({
    where: {
      sessionTokenHash: hashSessionToken(sessionToken),
      revokedAt: null,
      expiresAt: { gt: now },
      customer: {
        shopId,
      },
    },
    include: {
      customer: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

async function findCustomerSessionForDifferentShop(sessionToken: string, shopId: string) {
  const now = new Date();

  return prisma.authSession.findFirst({
    where: {
      sessionTokenHash: hashSessionToken(sessionToken),
      revokedAt: null,
      expiresAt: { gt: now },
      customer: {
        shopId: {
          not: shopId,
        },
      },
    },
    select: {
      id: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function requireExpressCheckoutShop(
  req: NextRequest
): Promise<ExpressCheckoutShopContext | ExpressCheckoutSafetyError> {
  if (isExpressCheckoutGloballyDisabled()) {
    return { status: 403, error: "Express checkout disabled" };
  }

  try {
    const shop = await requireStorefrontShopFromRequest(req);
    const readiness = await resolveExpressCheckoutReadiness(shop.id);
    if (!readiness.ready) {
      console.info("express_checkout_shopify_fallback", { shopId: shop.id, entryPoint: req.nextUrl.pathname, ...readiness });
      return { status: 403, code: EXPRESS_CHECKOUT_NOT_READY, error: "Express Checkout is currently unavailable. Continuing to secure checkout." };
    }

    return {
      shopDomain: shop.shopDomain,
      shopId: shop.id,
    };
  } catch (error) {
    if (error instanceof ShopResolutionError) {
      return { status: 403, error: "Express checkout disabled" };
    }

    throw error;
  }
}

export async function requireCustomerSessionForShop(
  sessionToken: string,
  shopId: string
): Promise<ExpressCheckoutCustomerSessionContext | ExpressCheckoutSafetyError> {
  const normalizedSessionToken = String(sessionToken || "").trim();
  const normalizedShopId = String(shopId || "").trim();

  if (!normalizedSessionToken || !normalizedShopId) {
    return { status: 401, error: "Authentication required" };
  }

  const session = await findCustomerSessionForShop(normalizedSessionToken, normalizedShopId);

  if (session) {
    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    return {
      customer: session.customer,
      session,
    };
  }

  const crossShopSession = await findCustomerSessionForDifferentShop(
    normalizedSessionToken,
    normalizedShopId
  );

  if (crossShopSession) {
    return { status: 403, error: "Invalid customer session" };
  }

  return { status: 401, error: "Authentication required" };
}
