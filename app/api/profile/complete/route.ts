import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { hashSessionToken } from "../../../../services/auth/session";
import { withCors, handleOptions } from "../../_lib/cors";
import {
  findOrCreateShopifyCustomer,
  isShopifyAdminConfigured,
} from "../../../../services/shopify/admin";
import {
  ShopResolutionError,
  requireShopFromRequest,
} from "../../../../services/shopify/shop";

function normalizeEmail(emailRaw: string) {
  return emailRaw.trim().toLowerCase();
}

function normalizeFullName(fullNameRaw: string) {
  return fullNameRaw.replace(/\s+/g, " ").trim();
}

function normalizeText(valueRaw: string) {
  return valueRaw.replace(/\s+/g, " ").trim();
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const shop = await requireShopFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const firstName = normalizeText(String(body?.firstName ?? ""));
    const lastName = normalizeText(String(body?.lastName ?? ""));
    const fullName = normalizeFullName(`${firstName} ${lastName}`);
    const email = normalizeEmail(String(body?.email ?? ""));
    const addressLine1 = normalizeText(String(body?.addressLine1 ?? ""));
    const addressLine2 = normalizeText(String(body?.addressLine2 ?? ""));
    const city = normalizeText(String(body?.city ?? ""));
    const stateProvince = normalizeText(String(body?.stateProvince ?? ""));
    const postalCode = normalizeText(String(body?.postalCode ?? ""));
    const countryRegion = normalizeText(
      String(body?.countryRegion ?? "India")
    );

    if (!firstName) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: "First name is required" },
          { status: 400 }
        )
      );
    }

    if (!lastName) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: "Last name is required" },
          { status: 400 }
        )
      );
    }

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

    if (!addressLine1 || !city || !stateProvince || !postalCode || !countryRegion) {
      return withCors(
        req,
        NextResponse.json(
          {
            success: false,
            error:
              "Address line 1, city, state/province, postal/PIN code, and country/region are required",
          },
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
        expiresAt: {
          gt: now,
        },
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
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: "Invalid or expired session" },
          { status: 401 }
        )
      );
    }

    let updatedCustomer = await prisma.customerProfile.update({
      where: {
        id: session.customer.id,
      },
      data: {
        firstName,
        lastName,
        fullName,
        email,
        addressLine1,
        addressLine2: addressLine2 || null,
        city,
        stateProvince,
        postalCode,
        countryRegion,
        profileCompletedAt: now,
      },
    });

    let shopifySync:
      | {
          ok: boolean;
          status:
            | "skipped-already-linked"
            | "skipped-not-configured"
            | "linked-existing"
            | "created-new"
            | "failed";
          matchedBy?: "email" | "phone";
          message?: string;
        }
      | undefined;

    if (updatedCustomer.shopifyCustomerId) {
      console.log("[SHOPIFY SYNC] skipped because already linked", {
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        customerProfileId: updatedCustomer.id,
        shopifyCustomerId: updatedCustomer.shopifyCustomerId,
      });
      shopifySync = { ok: true, status: "skipped-already-linked" };
    } else if (!isShopifyAdminConfigured()) {
      console.warn("[SHOPIFY SYNC] skipped because Shopify admin config is missing", {
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        customerProfileId: updatedCustomer.id,
      });
      shopifySync = { ok: false, status: "skipped-not-configured" };
    } else {
      try {
        const syncResult = await findOrCreateShopifyCustomer({
          fullName: updatedCustomer.fullName,
          email: updatedCustomer.email,
          phoneE164: updatedCustomer.phoneE164,
        });

        updatedCustomer = await prisma.customerProfile.update({
          where: { id: updatedCustomer.id },
          data: { shopifyCustomerId: syncResult.shopifyCustomerId },
        });

        if (syncResult.source === "existing") {
          console.log("[SHOPIFY SYNC] existing Shopify customer linked", {
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            customerProfileId: updatedCustomer.id,
            shopifyCustomerId: syncResult.shopifyCustomerId,
            matchedBy: syncResult.matchedBy,
          });
          shopifySync = {
            ok: true,
            status: "linked-existing",
            matchedBy: syncResult.matchedBy,
          };
        } else {
          console.log("[SHOPIFY SYNC] new Shopify customer created", {
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            customerProfileId: updatedCustomer.id,
            shopifyCustomerId: syncResult.shopifyCustomerId,
          });
          shopifySync = { ok: true, status: "created-new" };
        }
      } catch (syncError) {
        const message =
          syncError instanceof Error ? syncError.message : "Shopify sync failed";
        console.error("[SHOPIFY SYNC] failed", {
          shopId: shop.id,
          shopDomain: shop.shopDomain,
          customerProfileId: updatedCustomer.id,
          message,
        });
        shopifySync = {
          ok: false,
          status: "failed",
          message,
        };
      }
    }

    await prisma.authSession.update({
      where: {
        id: session.id,
      },
      data: {
        lastSeenAt: now,
      },
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
          addressLine1: updatedCustomer.addressLine1,
          addressLine2: updatedCustomer.addressLine2,
          city: updatedCustomer.city,
          stateProvince: updatedCustomer.stateProvince,
          postalCode: updatedCustomer.postalCode,
          countryRegion: updatedCustomer.countryRegion,
          profileCompletedAt: updatedCustomer.profileCompletedAt,
          phoneVerifiedAt: updatedCustomer.phoneVerifiedAt,
          shopifyCustomerId: updatedCustomer.shopifyCustomerId,
        },
        profileComplete: Boolean(
          updatedCustomer.firstName?.trim() &&
            updatedCustomer.lastName?.trim() &&
            updatedCustomer.email?.trim() &&
            updatedCustomer.addressLine1?.trim() &&
            updatedCustomer.city?.trim() &&
            updatedCustomer.stateProvince?.trim() &&
            updatedCustomer.postalCode?.trim() &&
            updatedCustomer.countryRegion?.trim()
        ),
        shopifyCustomerId: updatedCustomer.shopifyCustomerId,
        shopifySync,
      })
    );
  } catch (error) {
    console.error("[PROFILE COMPLETE ERROR]", error);

    const status =
      error instanceof ShopResolutionError ? error.status : 500;

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
