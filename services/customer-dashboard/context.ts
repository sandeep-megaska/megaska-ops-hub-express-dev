import type { NextRequest } from "next/server";

import { getSessionTokenFromRequest, hashSessionToken } from "../auth/session.ts";
import { CustomerDashboardError } from "./errors.ts";

export type CustomerDashboardContext = {
  shopId: string;
  shopDomain: string;
  customerProfileId: string;
  sessionId: string;
  now: Date;
};

type ShopLike = { id: string; shopDomain: string };
type CustomerLike = { id: string; shopId?: string | null } | null;
type AuthSessionLike = { id: string; customerProfileId: string; customer: CustomerLike } | null;

type ContextDependencies = {
  requireShopFromRequest: (req: NextRequest) => Promise<ShopLike>;
  getSessionTokenFromRequest: (req: NextRequest) => string;
  hashSessionToken: (token: string) => string;
  authSession: {
    findFirst: (args: unknown) => Promise<AuthSessionLike>;
    update: (args: unknown) => Promise<unknown>;
  };
  now: () => Date;
};

const defaultDependencies: ContextDependencies = {
  requireShopFromRequest: async (req) => {
    const mod = await import("../shopify/shop.ts");
    return mod.requireShopFromRequest(req);
  },
  getSessionTokenFromRequest,
  hashSessionToken,
  authSession: {
    findFirst: async (args) => {
      const mod = await import("../db/prisma.ts");
      return mod.prisma.authSession.findFirst(args as never) as Promise<AuthSessionLike>;
    },
    update: async (args) => {
      const mod = await import("../db/prisma.ts");
      return mod.prisma.authSession.update(args as never);
    },
  },
  now: () => new Date(),
};

let dependencies: ContextDependencies = defaultDependencies;

export function setCustomerDashboardContextDependenciesForTest(overrides: Partial<ContextDependencies>) {
  dependencies = { ...defaultDependencies, ...overrides };
}

export function resetCustomerDashboardContextDependenciesForTest() {
  dependencies = defaultDependencies;
}

export async function resolveCustomerDashboardContext(req: NextRequest): Promise<CustomerDashboardContext> {
  try {
    let shop: ShopLike;
    try {
      shop = await dependencies.requireShopFromRequest(req);
    } catch (error) {
      throw new CustomerDashboardError({ code: "SHOP_REQUIRED", message: "Shop context is required.", status: 400, cause: error });
    }

    const sessionToken = dependencies.getSessionTokenFromRequest(req);
    if (!sessionToken) {
      throw new CustomerDashboardError({ code: "SESSION_REQUIRED", message: "Session token is required.", status: 401 });
    }

    const now = dependencies.now();
    const session = await dependencies.authSession.findFirst({
      where: { sessionTokenHash: dependencies.hashSessionToken(sessionToken), revokedAt: null, expiresAt: { gt: now } },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    });

    if (!session) {
      throw new CustomerDashboardError({ code: "SESSION_EXPIRED", message: "Your session has expired. Please verify your phone again.", status: 401 });
    }

    const customer = session.customer;
    if (!customer) {
      throw new CustomerDashboardError({ code: "CUSTOMER_NOT_FOUND", message: "Customer profile was not found.", status: 404 });
    }

    // AuthSession is not directly shop-scoped in the current Prisma schema. Tenant safety is
    // enforced through CustomerProfile.shopId where present, without changing legacy session behavior.
    if (customer.shopId && customer.shopId !== shop.id) {
      throw new CustomerDashboardError({ code: "SESSION_EXPIRED", message: "Your session has expired. Please verify your phone again.", status: 401 });
    }

    await dependencies.authSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });

    return { shopId: shop.id, shopDomain: shop.shopDomain, customerProfileId: customer.id, sessionId: session.id, now };
  } catch (error) {
    if (error instanceof CustomerDashboardError) throw error;
    throw new CustomerDashboardError({ code: "DASHBOARD_UNAVAILABLE", message: "We could not load your dashboard right now. Please try again.", status: 503, retryable: true, cause: error });
  }
}
