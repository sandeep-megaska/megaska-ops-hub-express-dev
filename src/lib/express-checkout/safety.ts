import type { NextRequest } from "next/server";
import { prisma } from "../../../services/db/prisma";
import { hashSessionToken } from "../../../services/auth/session";
import {
  getShopDomainFromRequest,
  normalizeShopDomain,
  requireShopFromRequest,
  ShopResolutionError,
} from "../../../services/shopify/shop";

export type ExpressCheckoutSafetyError = {
  status: 401 | 403;
  error: string;
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

function isExpressCheckoutEnabled() {
  return process.env.EXPRESS_CHECKOUT_ENABLED === "true";
}

function getAllowedShopDomains() {
  return String(process.env.EXPRESS_CHECKOUT_ALLOWED_SHOPS || "")
    .split(",")
    .map((shopDomain) => normalizeShopDomain(shopDomain))
    .filter(Boolean);
}

function isAllowedShop(shopDomain: string) {
  const normalizedShopDomain = normalizeShopDomain(shopDomain);
  if (!normalizedShopDomain) return false;

  return getAllowedShopDomains().includes(normalizedShopDomain);
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
  if (!isExpressCheckoutEnabled()) {
    return { status: 403, error: "Express checkout disabled" };
  }

  const shopDomain = getShopDomainFromRequest(req);

  if (!isAllowedShop(shopDomain)) {
    return { status: 403, error: "Express checkout disabled" };
  }

  try {
    const shop = await requireShopFromRequest(req);

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
