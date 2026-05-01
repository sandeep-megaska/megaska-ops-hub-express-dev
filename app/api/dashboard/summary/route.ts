import { MegaskaOrderStatus } from "../../../../generated/prisma";
import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { prisma } from "../../../../services/db/prisma";
import { hashSessionToken } from "../../../../services/auth/session";
import {
  debugShopifyAdminAuth,
  findShopifyCustomerIdByIdentity,
  isShopifyAdminConfigured,
} from "../../../../services/shopify/admin";
import { getMegaskaCustomerDashboardData } from "../../../../services/shopify/dashboard";
import {
  ShopResolutionError,
  requireShopFromRequest,
} from "../../../../services/shopify/shop";
import { isCancellationStatusBlocking } from "../../../../services/exchange/cancellation";
import { ACTIVE_EXCHANGE_STATUSES } from "../../../../services/exchange/lifecycle";
import { getOrCreateWalletAccount, listWalletTransactions } from "../../../../services/wallet";

export const runtime = "nodejs";

function formatShipmentTimelineStatus(status: MegaskaOrderStatus) {
  return status.replace(/_/g, " ");
}


export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

function getSessionToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const queryToken = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  return bearerToken || queryToken;
}

export async function GET(req: NextRequest) {
  try {
    const shop = await requireShopFromRequest(req);

    const sessionToken = getSessionToken(req);
    if (!sessionToken) {
      return withCors(
        req,
        NextResponse.json({ error: "Session token required" }, { status: 401 })
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

    if (!session) {
      return withCors(
        req,
        NextResponse.json({ error: "Invalid or expired session" }, { status: 401 })
      );
    }

    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });

    const customer = session.customer;

  let resolvedShopifyCustomerId = String(customer.shopifyCustomerId || "").trim();

if (isShopifyAdminConfigured()) {
  let emailMatchId = "";
  let phoneMatchId = "";

  if (customer.email) {
    emailMatchId =
      (await findShopifyCustomerIdByIdentity({
        shopDomain: shop.shopDomain,
        email: customer.email,
      })) || "";
  }

  if (!emailMatchId && customer.phoneE164) {
    phoneMatchId =
      (await findShopifyCustomerIdByIdentity({
        shopDomain: shop.shopDomain,
        phoneE164: customer.phoneE164,
      })) || "";
  }

  const bestMatch = emailMatchId || phoneMatchId;

  if (bestMatch && bestMatch !== resolvedShopifyCustomerId) {
    resolvedShopifyCustomerId = bestMatch;

    await prisma.customerProfile.update({
      where: { id: customer.id },
      data: { shopifyCustomerId: bestMatch },
    });
  }
}

let shopifyDashboard = null;    

if (isShopifyAdminConfigured()) {
  try {
    shopifyDashboard = await getMegaskaCustomerDashboardData({
      shopDomain: shop.shopDomain,
      customerId: resolvedShopifyCustomerId || null,
      email: customer.email,
      phoneE164: customer.phoneE164,
    });
  } catch (error) {
    console.error("[DASHBOARD SUMMARY] Shopify dashboard fetch failed", {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

    const savedAddressCount = shopifyDashboard?.defaultAddress
      ? 1
      : customer.addressLine1
        ? 1
        : 0;

    const totalOrders = Number(shopifyDashboard?.totalOrderCount || 0);
    const orderNumbers = Array.isArray(shopifyDashboard?.recentOrders)
      ? shopifyDashboard.recentOrders.map((order) => String(order?.name || "").trim()).filter(Boolean)
      : [];

    const cancellationRequests = orderNumbers.length
      ? await prisma.orderActionRequest.findMany({
          where: {
            customerProfileId: customer.id,
            requestType: "CANCELLATION",
            orderNumber: { in: orderNumbers },
          },
          orderBy: { requestedAt: "desc" },
          select: {
            orderNumber: true,
            status: true,
            requestedAt: true,
          },
        })
      : [];

    const latestCancellationByOrder = new Map<string, { status: string; requestedAt: Date }>();
    for (const request of cancellationRequests) {
      if (!latestCancellationByOrder.has(request.orderNumber)) {
        latestCancellationByOrder.set(request.orderNumber, {
          status: request.status,
          requestedAt: request.requestedAt,
        });
      }
    }

    const exchangeRequests = orderNumbers.length
      ? await prisma.orderActionRequest.findMany({
          where: {
            customerProfileId: customer.id,
            requestType: "EXCHANGE",
            orderNumber: { in: orderNumbers },
          },
          orderBy: { requestedAt: "desc" },
          select: {
            orderNumber: true,
            status: true,
            requestedAt: true,
          },
        })
      : [];

    const latestExchangeByOrder = new Map<string, { status: string; requestedAt: Date }>();
    for (const request of exchangeRequests) {
      if (!latestExchangeByOrder.has(request.orderNumber)) {
        latestExchangeByOrder.set(request.orderNumber, {
          status: request.status,
          requestedAt: request.requestedAt,
        });
      }
    }

    const issueRequests = orderNumbers.length
      ? await prisma.orderActionRequest.findMany({
          where: {
            customerProfileId: customer.id,
            requestType: "ISSUE",
            orderNumber: { in: orderNumbers },
          },
          orderBy: { requestedAt: "desc" },
          select: {
            orderNumber: true,
            status: true,
            requestedAt: true,
          },
        })
      : [];

    const latestIssueByOrder = new Map<string, { status: string; requestedAt: Date }>();
    for (const request of issueRequests) {
      if (!latestIssueByOrder.has(request.orderNumber)) {
        latestIssueByOrder.set(request.orderNumber, {
          status: request.status,
          requestedAt: request.requestedAt,
        });
      }
    }

    const openRequests = cancellationRequests.filter((request) =>
      isCancellationStatusBlocking(request.status)
    ).length;

    const walletAccount = await getOrCreateWalletAccount(customer.id, "INR");
    const walletTransactions = await listWalletTransactions(customer.id, "INR", 15);

    const walletReservedRows = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COALESCE(SUM("reservedAmount"), 0)::int AS total
      FROM "WalletReservation"
      WHERE "customerProfileId" = ${customer.id}
        AND "status" = 'ACTIVE'::"WalletReservationStatus"
        AND "expiresAt" > NOW()
    `;
    const activeWalletReserved = Number(walletReservedRows[0]?.total || 0);

    const stats = {
      totalOrders,
      openRequests,
      savedAddresses: savedAddressCount,
    };

    const megaskaOrders = orderNumbers.length
      ? await prisma.megaskaOrder.findMany({
          where: {
            customerProfileId: customer.id,
            shopId: shop.id,
            shopifyOrderName: { in: orderNumbers },
          },
          include: {
            shipments: {
              include: {
                events: {
                  orderBy: { occurredAt: "desc" },
                  take: 8,
                },
              },
              orderBy: { updatedAt: "desc" },
            },
          },
        })
      : [];

    const orderTrackingByOrderName = new Map(
      megaskaOrders.map((order) => [
        order.shopifyOrderName,
        {
          orderStatus: order.status,
          fallback: {
            title: "Order confirmed",
            message: "Tracking will appear once your order is shipped.",
          },
          shipments: order.shipments.map((shipment) => ({
            id: shipment.id,
            provider: shipment.provider,
            awb: shipment.awb,
            trackingUrl: shipment.trackingUrl,
            normalizedStatus: shipment.normalizedStatus,
            statusLabel: formatShipmentTimelineStatus(shipment.normalizedStatus),
            statusUpdatedAt: shipment.statusUpdatedAt,
            isMock: Boolean((shipment.metadata as { mock?: boolean } | null)?.mock),
            timeline: shipment.events.map((event) => ({
              id: event.id,
              normalizedStatus: event.normalizedStatus,
              statusLabel: formatShipmentTimelineStatus(event.normalizedStatus),
              occurredAt: event.occurredAt,
              description: event.description,
              location: event.location,
              isMock: Boolean((event.metadata as { mock?: boolean } | null)?.mock),
            })),
          })),
        },
      ])
    );

    const orders = (shopifyDashboard?.recentOrders || []).map((order) => {
      const orderNumber = String(order?.name || "").trim();
      const latestCancellation = latestCancellationByOrder.get(orderNumber);
      const latestExchange = latestExchangeByOrder.get(orderNumber);
      const latestIssue = latestIssueByOrder.get(orderNumber);

      return {
        ...order,
        latestCancellationStatus: latestCancellation?.status || null,
        latestExchangeStatus: latestExchange?.status || null,
        latestIssueStatus: latestIssue?.status || null,
        tracking: (() => {
          const tracking = orderTrackingByOrderName.get(orderNumber) || null;
          if (!tracking) return null;
          const hasShipmentWithAwb = tracking.shipments.some((shipment) => Boolean(String(shipment.awb || "").trim()));
          return {
            ...tracking,
            hasTracking: hasShipmentWithAwb,
          };
        })(),
        hasActiveExchangeRequest: ACTIVE_EXCHANGE_STATUSES.includes(
          String(latestExchange?.status || "").trim().toUpperCase() as (typeof ACTIVE_EXCHANGE_STATUSES)[number]
        ),
      };
    });

    const response = {
      customer: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phoneE164,
        email: shopifyDashboard?.email || customer.email || null,
        verified: Boolean(customer.phoneVerifiedAt),
      },
      wallet: {
        balance: walletAccount?.currentBalance || 0,
        currency: walletAccount?.currency || "INR",
        pendingRefund: 0,
        reserved: activeWalletReserved,
        availableToRedeem: Math.max((walletAccount?.currentBalance || 0) - activeWalletReserved, 0),
        transactions: walletTransactions,
      },
      stats,
      address: shopifyDashboard?.defaultAddress
        ? shopifyDashboard.defaultAddress
        : customer.addressLine1
          ? {
              line1: customer.addressLine1 || null,
              line2: customer.addressLine2 || null,
              city: customer.city || null,
              state: customer.stateProvince || null,
              postalCode: customer.postalCode || null,
              country: customer.countryRegion || null,
            }
          : null,
      orders,
    };

    return withCors(req, NextResponse.json(response));
  } catch (error) {
    const status =
      error instanceof ShopResolutionError ? error.status : 500;

    return withCors(
      req,
      NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Internal error",
        },
        { status }
      )
    );
  }
}
