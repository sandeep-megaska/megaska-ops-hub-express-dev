import { NextRequest } from "next/server";
import { prisma } from "../db/prisma";
import { hashSessionToken } from "../auth/session";
import {
  ShopResolutionError,
  requireShopFromRequest,
  type ShopRow,
} from "../shopify/shop";

export type AuthenticatedExchangeCustomer = {
  shop: ShopRow;
  session: Awaited<ReturnType<typeof getAuthenticatedExchangeCustomer>>;
};

function getSessionToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const queryToken = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  return bearerToken || queryToken;
}

/**
 * Legacy helper kept for backward compatibility in non-shop-scoped flows.
 * Avoid using this in exchange/cancellation/issue/GST request flows.
 */
export async function getAuthenticatedCustomer(req: NextRequest) {
  const sessionToken = getSessionToken(req);

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

/**
 * Strict helper for shop-sensitive customer flows.
 * Requires request shop context and binds session to customer.shopId.
 */
export async function getAuthenticatedExchangeCustomer(req: NextRequest) {
  const shop = await requireShopFromRequest(req);
  const sessionToken = getSessionToken(req);

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
    session,
  };
}

export { ShopResolutionError };
