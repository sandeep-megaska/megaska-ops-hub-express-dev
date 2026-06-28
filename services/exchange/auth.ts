import { NextRequest } from "next/server";
import { prisma } from "../db/prisma";
import { getSessionTokenFromRequest, hashSessionToken } from "../auth/session";
import {
  requireShopFromRequest,
  type ShopRow,
} from "../shopify/shop";


/**
 * Legacy helper kept for backward compatibility in non-shop-scoped flows.
 * Avoid using this in exchange/cancellation/issue/GST request flows.
 */
export async function getAuthenticatedCustomer(req: NextRequest) {
  const sessionToken = getSessionTokenFromRequest(req);

  if (!sessionToken) {
    return null;
  }

  return prisma.authSession.findFirst({
    where: {
      sessionTokenHash: hashSessionToken(sessionToken),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });
}

export type AuthenticatedExchangeContext = {
  shop: ShopRow;
  session: {
    id: string;
    customer: {
      id: string;
      shopId: string | null;
      shopifyCustomerId: string | null;
      firstName: string | null;
      lastName: string | null;
      fullName: string | null;
      phoneE164: string | null;
      email: string | null;
    };
  };
};

/**
 * Strict helper for shop-sensitive customer flows.
 * Requires request shop context and binds session to customer.shopId.
 */
export async function getAuthenticatedExchangeCustomer(
  req: NextRequest
): Promise<AuthenticatedExchangeContext | null> {
  const shop = await requireShopFromRequest(req);
  const sessionToken = getSessionTokenFromRequest(req);

  if (!sessionToken) {
    return null;
  }

  const now = new Date();

  const session = await prisma.authSession.findFirst({
    where: {
      sessionTokenHash: hashSessionToken(sessionToken),
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

  if (!session) {
    return null;
  }

  await prisma.authSession.update({
    where: { id: session.id },
    data: { lastSeenAt: now },
  });

  return {
    shop,
    session: {
      id: session.id,
      customer: {
        id: session.customer.id,
        shopId: session.customer.shopId,
        shopifyCustomerId: session.customer.shopifyCustomerId,
        firstName: session.customer.firstName,
        lastName: session.customer.lastName,
        fullName: session.customer.fullName,
        phoneE164: session.customer.phoneE164,
        email: session.customer.email,
      },
    },
  };
}
