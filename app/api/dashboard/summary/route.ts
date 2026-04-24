import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { prisma } from "../../../../services/db/prisma";
import { hashSessionToken } from "../../../../services/auth/session";
import {
  debugShopifyAdminAuth,
  findShopifyCustomerIdByIdentity,
  getShopifyCustomerDashboardData,
  isShopifyAdminConfigured,
} from "../../../../services/shopify/admin";
import {
  ShopResolutionError,
  requireShopFromRequest,
} from "../../../../services/shopify/shop";
import { isCancellationStatusBlocking } from "../../../../services/exchange/cancellation";
import { ACTIVE_EXCHANGE_STATUSES } from "../../../../services/exchange/lifecycle";
import { getOrCreateWalletAccount, listWalletTransactions } from "../../../../services/wallet";

export const runtime = "nodejs";

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
        NextResponse.json({ error: "Invalid or expired session" }, { status: 401 })
      );
    }

    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });

    const customer = session.customer;

    let resolvedShopifyCustomerId = String(customer.shopifyCustomerId || "").trim();
    let shopifyDashboard = null;

    console.log("[DASHBOARD SUMMARY] start", {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      customerId: customer.id,
      phoneE164: customer.phoneE164,
      email: customer.email,
      existingShopifyCustomerId: customer.shopifyCustomerId,
      adminConfigured: isShopifyAdminConfigured(),
    });

    if (isShopifyAdminConfigured()) {
      try {
        try {
          const authProbe = await debugShopifyAdminAuth({
  shopDomain: shop.shopDomain,
});
          console.log("[SHOPIFY AUTH PROBE] success", {
            shopName: authProbe?.shop?.name || null,
            myshopifyDomain: authProbe?.shop?.myshopifyDomain || null,
          });
        } catch (error) {
          console.error("[SHOPIFY AUTH PROBE] failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        if (!resolvedShopifyCustomerId) {
          console.log("[DASHBOARD SUMMARY] resolving Shopify customer identity", {
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            email: customer.email || null,
            phoneE164: customer.phoneE164 || null,
          });

        if (customer.email) {
  resolvedShopifyCustomerId =
    (await findShopifyCustomerIdByIdentity({
      shopDomain: shop.shopDomain,
      email: customer.email,
    })) || "";
}

            console.log("[DASHBOARD SUMMARY] email lookup result", {
              email: customer.email,
              resolvedShopifyCustomerId: resolvedShopifyCustomerId || null,
            });
          }

          if (!resolvedShopifyCustomerId && customer.phoneE164) {
            resolvedShopifyCustomerId =
              (await findShopifyCustomerIdByIdentity({
                 shopDomain: shop.shopDomain,
                phoneE164: customer.phoneE164,
              })) || "";

            console.log("[DASHBOARD SUMMARY] phone lookup result", {
              phoneE164: customer.phoneE164,
              resolvedShopifyCustomerId: resolvedShopifyCustomerId || null,
            });
          }

          if (resolvedShopifyCustomerId) {
            await prisma.customerProfile.update({
              where: { id: customer.id },
              data: { shopifyCustomerId: resolvedShopifyCustomerId },
            });

            console.log("[DASHBOARD SUMMARY] saved resolved Shopify customer id", {
              shopId: shop.id,
              customerId: customer.id,
              resolvedShopifyCustomerId,
            });
          }
        }

        if (resolvedShopifyCustomerId) {
         shopifyDashboard = await getShopifyCustomerDashboardData({
  shopDomain: shop.shopDomain,
  customerId: resolvedShopifyCustomerId,
});
          const dashboard = shopifyDashboard;
          console.log("[DASHBOARD SUMMARY] dashboard data used", {
            shopId: shop.id,
            resolvedShopifyCustomerId,
            totalOrderCount: dashboard?.totalOrderCount ?? null,
            recentOrdersCount: dashboard?.recentOrders?.length ?? null,
            hasDefaultAddress: Boolean(dashboard?.defaultAddress),
          });
          console.log("[DASHBOARD SUMMARY] dashboard result", {
            shopId: shop.id,
            resolvedShopifyCustomerId,
            foundEmail: shopifyDashboard?.email || null,
            totalOrderCount: shopifyDashboard?.totalOrderCount || 0,
            recentOrdersCount: Array.isArray(shopifyDashboard?.recentOrders)
              ? shopifyDashboard.recentOrders.length
              : 0,
            hasDefaultAddress: Boolean(shopifyDashboard?.defaultAddress),
          });
        } else {
          console.log("[DASHBOARD SUMMARY] no Shopify customer resolved", {
            shopId: shop.id,
          });
        }
      } catch (error) {
        console.error("[DASHBOARD SUMMARY] Shopify customer fetch failed", error);
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
        ? {
            line1: shopifyDashboard.defaultAddress.address1 || null,
            line2: shopifyDashboard.defaultAddress.address2 || null,
            city: shopifyDashboard.defaultAddress.city || null,
            state: shopifyDashboard.defaultAddress.province || null,
            postalCode: shopifyDashboard.defaultAddress.zip || null,
            country: shopifyDashboard.defaultAddress.country || null,
          }
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

    console.log("[DASHBOARD SUMMARY] final response shape", {
      shopId: shop.id,
      totalOrders: stats.totalOrders,
      ordersLength: Array.isArray(orders) ? orders.length : null,
      firstOrderId: Array.isArray(orders) && orders[0] ? orders[0].id : null,
    });

    return withCors(req, NextResponse.json(response));
  } catch (error) {
    console.error("[DASHBOARD SUMMARY ERROR]", error);

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
