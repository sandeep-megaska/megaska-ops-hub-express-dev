import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { hashSessionToken } from "../../../../services/auth/session";
import { withCors, handleOptions } from "../../_lib/cors";
import {
  findShopifyCustomersByPhone,
  isShopifyAdminConfigured,
} from "../../../../services/shopify/admin";
import {
  ShopResolutionError,
  requireShopFromRequest,
} from "../../../../services/shopify/shop";
import { CanonicalCustomerResolver } from "../../../../services/customers/canonical-customer-resolver";

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

    if (customer.shopifyCustomerId) {
      return withCors(req, NextResponse.json({ success: true, status: "linked" }));
    }

    if (!customer.phoneE164 || !isShopifyAdminConfigured()) {
      return withCors(req, NextResponse.json({ success: true, status: "new" }));
    }

    const candidates = await findShopifyCustomersByPhone(customer.phoneE164, {
      shopDomain: shop.shopDomain,
    });

    if (candidates.length === 0) {
      return withCors(req, NextResponse.json({ success: true, status: "new" }));
    }

    if (candidates.length > 1) {
      return withCors(req, NextResponse.json({ success: true, status: "ambiguous" }));
    }

    const single = candidates[0];

    try {
      const identity = await new CanonicalCustomerResolver().resolveFromCheckout({
        shopId: shop.id,
        shopifyCustomerId: single.shopifyCustomerId,
        phoneE164: customer.phoneE164,
        phoneVerified: Boolean(customer.phoneVerifiedAt),
        customerAttributes: {
          firstName: single.firstName || undefined,
          lastName: single.lastName || undefined,
          fullName: [single.firstName, single.lastName].filter(Boolean).join(" ") || undefined,
        },
      });

      if (!identity.customerProfile || identity.customerProfile.id !== customer.id) {
        console.warn("[PROFILE LINK STATUS] auto-link identity conflict, falling back to manual entry", {
          shopId: shop.id,
          customerProfileId: customer.id,
          candidateShopifyCustomerId: single.shopifyCustomerId,
        });
        return withCors(req, NextResponse.json({ success: true, status: "new" }));
      }

      // Email isn't a matching identifier here (not independently verified), only a display backfill.
      await prisma.customerProfile.update({
        where: { id: customer.id },
        data: {
          profileCompletedAt: now,
          ...(single.email && !identity.customerProfile.email ? { email: single.email } : {}),
        },
      });

      return withCors(req, NextResponse.json({ success: true, status: "linked" }));
    } catch (autoLinkError) {
      console.error("[PROFILE LINK STATUS] auto-link failed, falling back to manual entry", {
        shopId: shop.id,
        customerProfileId: customer.id,
        message: autoLinkError instanceof Error ? autoLinkError.message : String(autoLinkError),
      });
      return withCors(req, NextResponse.json({ success: true, status: "new" }));
    }
  } catch (error) {
    console.error("[PROFILE LINK STATUS ERROR]", error);

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
