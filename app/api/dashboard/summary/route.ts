import { MegaskaOrderStatus } from "../../../../generated/prisma";
import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { prisma } from "../../../../services/db/prisma";
import {
  CUSTOMER_SESSION_COOKIE_NAME,
  hashSessionToken,
} from "../../../../services/auth/session";
import {
  findShopifyCustomerIdByIdentity,
  isShopifyAdminConfigured,
} from "../../../../services/shopify/admin";
import { getMegaskaCustomerDashboardData } from "../../../../services/shopify/dashboard";
import {
  ShopResolutionError,
  requireShopFromRequest,
} from "../../../../services/shopify/shop";
import {
  deriveCancellationOutcome,
  isCancellationStatusBlocking,
} from "../../../../services/exchange/cancellation";
import { ACTIVE_EXCHANGE_STATUSES } from "../../../../services/exchange/lifecycle";
import {
  findActiveRequest,
  formatRequestLockReason,
} from "../../../../services/exchange/request-interlocks";
import { isIssueStatusBlocking } from "../../../../services/exchange/issue";
import {
  EXCHANGE_REQUEST_WINDOW_LOCK_REASON,
  ISSUE_REQUEST_WINDOW_LOCK_REASON,
  REVERSE_PICKUP_WINDOW_LOCK_REASON,
  getRequestWindowExpiresAt,
  getReversePickupWindowExpiresAt,
  isWithinRequestWindow,
  isWithinReversePickupWindow,
} from "../../../../services/exchange/deadlines";
import {
  getOrCreateWalletAccount,
  listWalletTransactions,
} from "../../../../services/wallet";
import { readCustomerGiftCard } from "../../../../services/store-credit/gift-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DELIVERY_REQUIRED_LOCK_REASON =
  "Exchange and issue requests are available only after delivery.";

type DashboardIdentityTrace = {
  shopId: string;
  phoneE164: string | null;
  customerProfileId: string | null;
  shopifyCustomerId: string | null;
  sessionId: string | null;
  authenticatedUserId: string | null;
};

function traceDashboardIdentity(
  step: string,
  identity: DashboardIdentityTrace,
  details: Record<string, unknown> = {},
) {
  console.info("[DASHBOARD IDENTITY TRACE]", { step, ...identity, ...details });
}

function isValidDateValue(value: string | Date | null | undefined) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
}

function normalizeFulfillmentStatus(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function findInternalDeliveredAt(tracking: DashboardTracking | null | undefined) {
  const deliveredShipment = tracking?.shipments.find(
    (shipment) => shipment.normalizedStatus === "DELIVERED",
  );
  const deliveredAt = deliveredShipment?.statusUpdatedAt || null;
  return isValidDateValue(deliveredAt) ? String(deliveredAt) : null;
}

type DashboardTracking = {
  orderStatus: string | null;
  fallback: { title: string; message: string };
  shipments: Array<{
    id: string;
    provider: string | null;
    awb: string | null;
    trackingUrl: string | null;
    normalizedStatus: string | null;
    statusLabel: string;
    statusUpdatedAt: Date | string | null;
    isMock: boolean;
    timeline: Array<{
      id: string;
      normalizedStatus: string | null;
      statusLabel: string;
      occurredAt: Date | string;
      description: string | null;
      location: string | null;
      isMock: boolean;
    }>;
    source?: string;
  }>;
  hasTracking?: boolean;
  source?: string;
};

function formatShipmentTimelineStatus(status: MegaskaOrderStatus) {
  return status.replace(/_/g, " ");
}

function formatShopifyTrackingStatus(status: string | null | undefined) {
  const normalized = String(status || "").trim();
  if (!normalized) return "Tracking available";
  return normalized
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildShopifyFulfillmentTracking(order: {
  fulfillmentStatus?: string | null;
  fulfillments?: Array<{
    id?: string | null;
    status?: string | null;
    createdAt?: string | null;
    deliveredAt?: string | null;
    trackingInfo?: Array<{
      company?: string | null;
      number?: string | null;
      url?: string | null;
    }> | null;
  } | null> | null;
}): DashboardTracking | null {
  const shipments: DashboardTracking["shipments"] = (
    order.fulfillments || []
  ).flatMap((fulfillment) => {
    const trackingEntries = (fulfillment?.trackingInfo || []).filter((entry) =>
      Boolean(
        String(entry?.number || entry?.url || entry?.company || "").trim(),
      ),
    );

    return trackingEntries.map((entry, index) => {
      const statusLabel = formatShopifyTrackingStatus(
        fulfillment?.status || order.fulfillmentStatus,
      );
      const statusUpdatedAt =
        fulfillment?.deliveredAt || fulfillment?.createdAt || null;
      const timeline: DashboardTracking["shipments"][number]["timeline"] = [];
      if (fulfillment?.createdAt) {
        timeline.push({
          id: `${fulfillment?.id || "shopify-fulfillment"}-${index}-created`,
          normalizedStatus:
            fulfillment?.status || order.fulfillmentStatus || null,
          statusLabel,
          occurredAt: fulfillment.createdAt,
          description: "Fulfillment created in Shopify",
          location: null,
          isMock: false,
        });
      }
      if (fulfillment?.deliveredAt) {
        timeline.push({
          id: `${fulfillment?.id || "shopify-fulfillment"}-${index}-delivered`,
          normalizedStatus: "DELIVERED",
          statusLabel: "Delivered",
          occurredAt: fulfillment.deliveredAt,
          description: "Shipment delivered",
          location: null,
          isMock: false,
        });
      }

      return {
        id: `${fulfillment?.id || "shopify-fulfillment"}-${index}`,
        provider: entry?.company || null,
        awb: entry?.number || null,
        trackingUrl: entry?.url || null,
        normalizedStatus:
          fulfillment?.status || order.fulfillmentStatus || null,
        statusLabel,
        statusUpdatedAt,
        isMock: false,
        timeline,
        source: "shopify_fulfillment_tracking_info",
      };
    });
  });

  if (!shipments.length) return null;

  return {
    orderStatus: null,
    fallback: {
      title: "Tracking from Shopify",
      message: "Tracking details are provided by Shopify fulfillment data.",
    },
    shipments,
    hasTracking: shipments.some((shipment) =>
      Boolean(String(shipment.awb || shipment.trackingUrl || "").trim()),
    ),
    source: "shopify_fulfillment_tracking_info",
  };
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const shop = await requireShopFromRequest(req);

    const authorization = req.headers.get("authorization") || "";
    const bearerPresent = authorization.startsWith("Bearer ");
    const cookiePresent = Boolean(
      req.cookies.get(CUSTOMER_SESSION_COOKIE_NAME)?.value?.trim(),
    );
    // Never accept browser-provided identity from a dashboard URL. Only an
    // authenticated bearer credential or the HttpOnly session cookie is trusted.
    const sessionToken = bearerPresent
      ? authorization.slice(7).trim()
      : req.cookies.get(CUSTOMER_SESSION_COOKIE_NAME)?.value?.trim() || "";
    const unresolvedIdentity: DashboardIdentityTrace = {
      shopId: shop.id,
      phoneE164: null,
      customerProfileId: null,
      shopifyCustomerId: null,
      sessionId: null,
      authenticatedUserId: null,
    };
    traceDashboardIdentity("dashboard_api_request", unresolvedIdentity, {
      sessionTokenSource: bearerPresent
        ? "authorization_bearer"
        : cookiePresent
          ? "cookie"
          : "none",
      bearerPresent,
      cookiePresent,
    });
    if (!sessionToken) {
      return withCors(
        req,
        NextResponse.json({ error: "Session token required" }, { status: 401 }),
      );
    }

    const now = new Date();
    const session = await prisma.authSession.findFirst({
      where: {
        sessionTokenHash: hashSessionToken(sessionToken),
        revokedAt: null,
        expiresAt: { gt: now },
        customer: { shopId: shop.id },
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
          { error: "Invalid or expired session" },
          { status: 401 },
        ),
      );
    }

    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });

    const customer = session.customer;
    if (customer.id !== session.customerProfileId || customer.shopId !== shop.id) {
      return withCors(
        req,
        NextResponse.json({ error: "Invalid or expired session" }, { status: 401 }),
      );
    }
    const identity: DashboardIdentityTrace = {
      shopId: shop.id,
      phoneE164: customer.phoneE164,
      customerProfileId: customer.id,
      shopifyCustomerId: customer.shopifyCustomerId,
      sessionId: session.id,
      authenticatedUserId: customer.id,
    };
    traceDashboardIdentity("server_authentication", identity, {
      authSessionCustomerProfileId: session.customerProfileId,
    });
    traceDashboardIdentity("customer_profile_resolved", identity, {
      resolutionSource: "auth_session_customer_relation",
    });

    // Identity is normally resolved upstream (OTP/sync/checkout), but the dashboard
    // must not blindly trust it. OTP-only logins reach here with no shopifyCustomerId,
    // and profile-complete can bind a profile to a brand-new EMPTY Shopify customer
    // when a legacy phone-format record was missed. Either way the customer's real
    // orders are invisible and the dashboard renders "0 orders". So: try the linked
    // customer first, and if that yields no orders, self-heal by re-resolving the real
    // Shopify customer from the verified phone/email (variant-aware search) and persist
    // the corrected link.
    let resolvedShopifyCustomerId = String(customer.shopifyCustomerId || "").trim();
    let shopifyDashboard = null;

    if (isShopifyAdminConfigured()) {
      if (resolvedShopifyCustomerId) {
        try {
          shopifyDashboard = await getMegaskaCustomerDashboardData({
            shopDomain: shop.shopDomain,
            customerId: resolvedShopifyCustomerId,
          });
        } catch (error) {
          console.error("[DASHBOARD SUMMARY] Shopify dashboard fetch failed", {
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const linkedOrderCount =
        Number(shopifyDashboard?.totalOrderCount || 0) ||
        (shopifyDashboard?.recentOrders?.length || 0);

      if (linkedOrderCount === 0) {
        try {
          const identityCustomerId = await findShopifyCustomerIdByIdentity({
            shopDomain: shop.shopDomain,
            phoneE164: customer.phoneE164,
            email: customer.email,
          });
          if (identityCustomerId && identityCustomerId !== resolvedShopifyCustomerId) {
            const healed = await getMegaskaCustomerDashboardData({
              shopDomain: shop.shopDomain,
              customerId: identityCustomerId,
            });
            const healedOrderCount =
              Number(healed?.totalOrderCount || 0) ||
              (healed?.recentOrders?.length || 0);
            // Only relink when the re-resolved customer actually has orders, so a
            // customer who legitimately has none is never bound to the wrong record.
            if (healed && healedOrderCount > 0) {
              shopifyDashboard = healed;
              resolvedShopifyCustomerId = identityCustomerId;
              // Persist the correction. A unique-constraint failure here means a
              // duplicate Shopify-ID-only profile already owns this id (a known
              // reconciliation gap); the dashboard still renders this request.
              await prisma.customerProfile
                .update({
                  where: { id: customer.id },
                  data: { shopifyCustomerId: identityCustomerId },
                })
                .catch((persistError) => {
                  console.warn(
                    "[DASHBOARD SUMMARY] Could not persist healed shopifyCustomerId",
                    {
                      shopId: shop.id,
                      customerProfileId: customer.id,
                      healedShopifyCustomerId: identityCustomerId,
                      error:
                        persistError instanceof Error
                          ? persistError.message
                          : String(persistError),
                    },
                  );
                });
              traceDashboardIdentity("shopify_customer_relinked", identity, {
                previousShopifyCustomerId: customer.shopifyCustomerId,
                healedShopifyCustomerId: identityCustomerId,
              });
            }
          }
        } catch (error) {
          console.error("[DASHBOARD SUMMARY] Shopify identity self-heal failed", {
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const savedAddressCount = shopifyDashboard?.defaultAddress
      ? 1
      : customer.addressLine1
        ? 1
        : 0;
    traceDashboardIdentity("address_query", identity, {
      source: shopifyDashboard?.defaultAddress
        ? "shopify_default_address"
        : customer.addressLine1
          ? "customer_profile"
          : "none",
      resultCount: savedAddressCount,
    });

    const totalOrders = Number(shopifyDashboard?.totalOrderCount || 0);
    const orderNumbers = Array.isArray(shopifyDashboard?.recentOrders)
      ? shopifyDashboard.recentOrders
          .map((order) => String(order?.name || "").trim())
          .filter(Boolean)
      : [];
    traceDashboardIdentity("orders_query", identity, {
      source: "shopify_customer",
      filterShopifyCustomerId: resolvedShopifyCustomerId || null,
      resultCount: orderNumbers.length,
    });

    const cancellationRequests = orderNumbers.length
      ? await prisma.orderActionRequest.findMany({
          where: {
            shopId: shop.id,
            customerProfileId: customer.id,
            requestType: "CANCELLATION",
            orderNumber: { in: orderNumbers },
          },
          orderBy: { requestedAt: "desc" },
          select: {
            orderNumber: true,
            status: true,
            requestedAt: true,
            orderAmountSnapshot: true,
            id: true,
          },
        })
      : [];

    type CancellationRefundSummary = {
      id: string;
      status: string;
      method: string;
      amount: number;
      currency: string;
      orderActionRequestId: string | null;
      walletTransactionId?: string | null;
      createdAt?: Date | string | null;
      updatedAt?: Date | string | null;
    };
    const cancellationRefundRequests: CancellationRefundSummary[] = cancellationRequests.length
      ? await (
          prisma as typeof prisma & {
            refundRequest: {
              findMany: (args: unknown) => Promise<CancellationRefundSummary[]>;
            };
          }
        ).refundRequest.findMany({
          where: {
            shopId: shop.id,
            customerProfileId: customer.id,
            orderActionRequestId: {
              in: cancellationRequests.map((request) => request.id),
            },
          },
          orderBy: { updatedAt: "desc" },
        })
      : [];
    const cancellationRefundsByRequestId = new Map<string, CancellationRefundSummary[]>();
    for (const refund of cancellationRefundRequests) {
      const key = String(refund.orderActionRequestId || "");
      if (!cancellationRefundsByRequestId.has(key))
        cancellationRefundsByRequestId.set(key, []);
      cancellationRefundsByRequestId.get(key)?.push(refund);
    }

    const latestCancellationByOrder = new Map<
      string,
      {
        status: string;
        requestedAt: Date;
        cancellationOutcome: ReturnType<typeof deriveCancellationOutcome>;
      }
    >();
    for (const request of cancellationRequests) {
      if (!latestCancellationByOrder.has(request.orderNumber)) {
        latestCancellationByOrder.set(request.orderNumber, {
          status: request.status,
          requestedAt: request.requestedAt,
          cancellationOutcome: deriveCancellationOutcome({
            cancellationStatus: request.status,
            orderAmountSnapshot: request.orderAmountSnapshot,
            refundRequests:
              cancellationRefundsByRequestId.get(request.id) || [],
          }),
        });
      }
    }

    const exchangeRequests = orderNumbers.length
      ? await prisma.orderActionRequest.findMany({
          where: {
            shopId: shop.id,
            customerProfileId: customer.id,
            requestType: "EXCHANGE",
            orderNumber: { in: orderNumbers },
          },
          orderBy: { requestedAt: "desc" },
          select: {
  id: true,
  orderNumber: true,
  status: true,
  requestedAt: true,
  payments: {
    where: { purpose: "REVERSE_PICKUP_FEE" },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      paidAt: true,
      amount: true,
      currency: true,
    },
  },
  shipments: {
    select: {
      direction: true,
      carrier: true,
      awb: true,
      trackingUrl: true,
      status: true,
      pickupAt: true,
      shippedAt: true,
      deliveredAt: true,
      updatedAt: true,
    },
  },
}
        })
      : [];

   /* const latestExchangeByOrder = new Map<
      string,
      { status: string; requestedAt: Date }
    >();
    for (const request of exchangeRequests) {
      if (!latestExchangeByOrder.has(request.orderNumber)) {
        latestExchangeByOrder.set(request.orderNumber, {
          status: request.status,
          requestedAt: request.requestedAt,
        });
      }
    }*/
    function buildExchangeProgressSnapshot(request: {
  id: string;
  status: string;
  requestedAt: Date;
  payments: Array<{
    status: string;
    paidAt: Date | null;
    amount: number;
    currency: string;
  }>;
  shipments: Array<{
    direction: string;
    carrier: string | null;
    awb: string | null;
    trackingUrl: string | null;
    status: string;
    pickupAt: Date | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    updatedAt: Date;
  }>;
}) {
  const status = String(request.status || "").toUpperCase();
  const payment = request.payments[0] || null;
  const reverseShipment =
    request.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP") || null;
  const forwardShipment =
    request.shipments.find((shipment) => shipment.direction === "FORWARD_REPLACEMENT") || null;

  function stepState(step: string) {
    const completed: Record<string, boolean> = {
      REQUESTED: Boolean(request.requestedAt),
      FEE_PAID:
        payment?.status === "PAID" ||
        [
          "PAYMENT_RECEIVED",
          "APPROVED",
          "PICKUP_PENDING",
          "PICKUP_SCHEDULED",
          "PICKUP_COMPLETED",
          "ITEM_RECEIVED",
          "REPLACEMENT_PROCESSING",
          "REPLACEMENT_SHIPPED",
          "CLOSED",
        ].includes(status),
      PICKUP_SCHEDULED:
        ["SCHEDULED", "IN_TRANSIT", "DELIVERED"].includes(String(reverseShipment?.status || "")) ||
        [
          "PICKUP_SCHEDULED",
          "PICKUP_COMPLETED",
          "ITEM_RECEIVED",
          "REPLACEMENT_PROCESSING",
          "REPLACEMENT_SHIPPED",
          "CLOSED",
        ].includes(status),
      PICKED_UP:
        ["IN_TRANSIT", "DELIVERED"].includes(String(reverseShipment?.status || "")) ||
        [
          "PICKUP_COMPLETED",
          "ITEM_RECEIVED",
          "REPLACEMENT_PROCESSING",
          "REPLACEMENT_SHIPPED",
          "CLOSED",
        ].includes(status),
      ITEM_RECEIVED:
        reverseShipment?.status === "DELIVERED" ||
        ["ITEM_RECEIVED", "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "CLOSED"].includes(status),
      REPLACEMENT_SHIPPED:
        Boolean(forwardShipment?.awb) ||
        ["REPLACEMENT_SHIPPED", "CLOSED"].includes(status),
      COMPLETED: status === "CLOSED",
    };

    return completed[step] ? "completed" : "pending";
  }

  return {
    id: request.id,
    status,
    statusLabel: status.replace(/_/g, " "),
    requestedAt: request.requestedAt,
    payment: payment
      ? {
          status: payment.status,
          paidAt: payment.paidAt,
          amount: payment.amount,
          currency: payment.currency,
        }
      : null,
    reverseShipment: reverseShipment
      ? {
          status: reverseShipment.status,
          carrier: reverseShipment.carrier,
          awb: reverseShipment.awb,
          trackingUrl: reverseShipment.trackingUrl,
          pickupAt: reverseShipment.pickupAt,
          deliveredAt: reverseShipment.deliveredAt,
          updatedAt: reverseShipment.updatedAt,
        }
      : null,
    forwardShipment: forwardShipment
      ? {
          status: forwardShipment.status,
          carrier: forwardShipment.carrier,
          awb: forwardShipment.awb,
          trackingUrl: forwardShipment.trackingUrl,
          shippedAt: forwardShipment.shippedAt,
          deliveredAt: forwardShipment.deliveredAt,
          updatedAt: forwardShipment.updatedAt,
        }
      : null,
    steps: [
      { key: "REQUESTED", label: "Requested", state: stepState("REQUESTED") },
      { key: "FEE_PAID", label: "Fee Paid", state: stepState("FEE_PAID") },
      { key: "PICKUP_SCHEDULED", label: "Pickup Scheduled", state: stepState("PICKUP_SCHEDULED") },
      { key: "PICKED_UP", label: "Picked Up", state: stepState("PICKED_UP") },
      { key: "ITEM_RECEIVED", label: "Item Received", state: stepState("ITEM_RECEIVED") },
      { key: "REPLACEMENT_SHIPPED", label: "Replacement Shipped", state: stepState("REPLACEMENT_SHIPPED") },
      { key: "COMPLETED", label: "Completed", state: stepState("COMPLETED") },
    ],
  };
}

const latestExchangeByOrder = new Map<
  string,
  { status: string; requestedAt: Date; progress: ReturnType<typeof buildExchangeProgressSnapshot> }
>();

for (const request of exchangeRequests) {
  if (!latestExchangeByOrder.has(request.orderNumber)) {
    latestExchangeByOrder.set(request.orderNumber, {
      status: request.status,
      requestedAt: request.requestedAt,
      progress: buildExchangeProgressSnapshot(request),
    });
  }
}

    const issueRequests = orderNumbers.length
      ? await prisma.orderActionRequest.findMany({
          where: {
            shopId: shop.id,
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

    const latestIssueByOrder = new Map<
      string,
      { status: string; requestedAt: Date }
    >();
    for (const request of issueRequests) {
      if (!latestIssueByOrder.has(request.orderNumber)) {
        latestIssueByOrder.set(request.orderNumber, {
          status: request.status,
          requestedAt: request.requestedAt,
        });
      }
    }

    const openRequests = cancellationRequests.filter((request) =>
      isCancellationStatusBlocking(request.status),
    ).length;

    const walletAccount = await getOrCreateWalletAccount(customer.id, "INR", {
      shopId: shop.id,
    });
    const walletTransactions = await listWalletTransactions(
      customer.id,
      "INR",
      15,
      { shopId: shop.id },
    );

    const walletReservedRows = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COALESCE(SUM("reservedAmount"), 0)::int AS total
      FROM "WalletReservation"
      WHERE "shopId" = ${shop.id}
        AND "customerProfileId" = ${customer.id}
        AND "status" = 'ACTIVE'::"WalletReservationStatus"
        AND "expiresAt" > NOW()
    `;
    const activeWalletReserved = Number(walletReservedRows[0]?.total || 0);
    traceDashboardIdentity("wallet_query", identity, {
      filterShopId: shop.id,
      filterCustomerProfileId: customer.id,
      walletAccountId: walletAccount?.id || null,
      transactionCount: walletTransactions.length,
      activeReservedAmount: activeWalletReserved,
    });

    // The customer's store credit is mirrored to a Shopify gift card so it can be spent at
    // native checkout. Surface its code + live balance so returning customers can grab it
    // straight from the app-owned dashboard (best-effort - a Shopify hiccup must not fail
    // the whole dashboard load).
    let giftCard: { present: boolean; code?: string | null; last4?: string; balanceMinor?: number } = { present: false };
    try {
      const card = await readCustomerGiftCard({
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        customerProfileId: customer.id,
        currency: "INR",
      });
      if (card.ok && card.present) {
        giftCard = { present: true, code: card.code, last4: card.last4, balanceMinor: card.balancePaise };
      }
    } catch (error) {
      console.error("[DASHBOARD] gift_card_read_failed", { error: error instanceof Error ? error.message : String(error) });
    }

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

    const orderTrackingByOrderName = new Map<string, DashboardTracking>(
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
            statusLabel: formatShipmentTimelineStatus(
              shipment.normalizedStatus,
            ),
            statusUpdatedAt: shipment.statusUpdatedAt,
            isMock: Boolean(
              (shipment.metadata as { mock?: boolean } | null)?.mock,
            ),
            timeline: shipment.events.map((event) => ({
              id: event.id,
              normalizedStatus: event.normalizedStatus,
              statusLabel: formatShipmentTimelineStatus(event.normalizedStatus),
              occurredAt: event.occurredAt,
              description: event.description,
              location: event.location,
              isMock: Boolean(
                (event.metadata as { mock?: boolean } | null)?.mock,
              ),
            })),
          })),
        },
      ]),
    );

    const orders = (shopifyDashboard?.recentOrders || []).map((order) => {
      const orderNumber = String(order?.name || "").trim();
      const latestCancellation = latestCancellationByOrder.get(orderNumber);
      const latestExchange = latestExchangeByOrder.get(orderNumber);
      const latestIssue = latestIssueByOrder.get(orderNumber);
      const activeRequest = findActiveRequest([
        ...(latestCancellation
          ? [{ requestType: "CANCELLATION", status: latestCancellation.status }]
          : []),
        ...(latestExchange
          ? [{ requestType: "EXCHANGE", status: latestExchange.status }]
          : []),
        ...(latestIssue
          ? [{ requestType: "ISSUE", status: latestIssue.status }]
          : []),
      ]);
      const activeLockReason = formatRequestLockReason(activeRequest);
      const fulfillmentStatus = normalizeFulfillmentStatus(
        order?.fulfillmentStatus,
      );
      const shopifyDeliveredAt = String(order?.deliveredAt || "").trim() || null;
      const tracking = orderTrackingByOrderName.get(orderNumber);
      const internalDeliveredAt = findInternalDeliveredAt(tracking);
      const deliveredAt = shopifyDeliveredAt || internalDeliveredAt;
      const hasTrustedDeliveredAt = isValidDateValue(deliveredAt);
      const requestWindowExpiresAt = getRequestWindowExpiresAt(deliveredAt);
      const reversePickupWindowExpiresAt = getReversePickupWindowExpiresAt(deliveredAt);
      const withinRequestWindow = isWithinRequestWindow(deliveredAt);
      const withinReversePickupWindow = isWithinReversePickupWindow(deliveredAt);
      const delivered = hasTrustedDeliveredAt;
      const shippedOrInTransit =
        Boolean((order as { fulfilledAt?: string | null })?.fulfilledAt) ||
        [
          "FULFILLED",
          "SHIPPED",
          "IN_TRANSIT",
          "OUT_FOR_DELIVERY",
          "PARTIAL",
          "PARTIALLY_FULFILLED",
          "DELIVERED",
        ].includes(fulfillmentStatus);
      const notShipped = !delivered && !shippedOrInTransit;
      const deadlineRequestLockReason = delivered
        ? !deliveredAt || !withinRequestWindow
          ? EXCHANGE_REQUEST_WINDOW_LOCK_REASON
          : null
        : null;
      const issueLockReason = delivered
        ? !deliveredAt || !withinRequestWindow
          ? ISSUE_REQUEST_WINDOW_LOCK_REASON
          : null
        : null;
      const reversePickupLockReason = delivered
        ? !deliveredAt || !withinReversePickupWindow
          ? REVERSE_PICKUP_WINDOW_LOCK_REASON
          : null
        : null;
      const requestLockReason =
        activeLockReason ||
        deadlineRequestLockReason ||
        (!delivered ? DELIVERY_REQUIRED_LOCK_REASON : null);
      const canRequestCancellation = notShipped && !activeRequest;
      const canRequestExchange = delivered && hasTrustedDeliveredAt && withinRequestWindow && !activeRequest;
      const canReportIssue = delivered && hasTrustedDeliveredAt && withinRequestWindow && !activeRequest;
      const canCreateReversePickup = delivered && hasTrustedDeliveredAt && withinReversePickupWindow;

      return {
        ...order,
        canRequestCancellation,
        canRequestExchange,
        canReportIssue,
        canCreateReversePickup,
        requestWindowExpiresAt: requestWindowExpiresAt?.toISOString() || null,
        reversePickupWindowExpiresAt: reversePickupWindowExpiresAt?.toISOString() || null,
        requestLockReason,
        issueLockReason: activeLockReason || issueLockReason,
        reversePickupLockReason,
        latestCancellationStatus: latestCancellation?.status || null,
        latestCancellationRefundStatus:
          latestCancellation?.cancellationOutcome.refundRequirementLabel ||
          null,
        latestCancellationExplanation:
          latestCancellation?.cancellationOutcome.customerExplanation || null,
        latestExchangeStatus: latestExchange?.status || null,
        exchangeProgress: latestExchange?.progress || null,
        latestIssueStatus: latestIssue?.status || null,
        tracking: (() => {
          const tracking = orderTrackingByOrderName.get(orderNumber) || null;
          const shopifyFallbackTracking =
            buildShopifyFulfillmentTracking(order);

          if (!tracking) return shopifyFallbackTracking;

          const hasShipmentWithAwb = tracking.shipments.some((shipment) =>
            Boolean(String(shipment.awb || "").trim()),
          );
          if (!hasShipmentWithAwb && shopifyFallbackTracking)
            return shopifyFallbackTracking;

          return {
            ...tracking,
            hasTracking: hasShipmentWithAwb,
          };
        })(),
        hasActiveExchangeRequest: ACTIVE_EXCHANGE_STATUSES.includes(
          String(latestExchange?.status || "")
            .trim()
            .toUpperCase() as (typeof ACTIVE_EXCHANGE_STATUSES)[number],
        ),
        hasActiveCancellationRequest: Boolean(
          activeRequest?.requestType === "CANCELLATION",
        ),
        hasActiveIssueRequest: isIssueStatusBlocking(latestIssue?.status),
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
        availableToRedeem: Math.max(
          (walletAccount?.currentBalance || 0) - activeWalletReserved,
          0,
        ),
        transactions: walletTransactions,
        giftCard,
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

    const jsonResponse = NextResponse.json(response);
    jsonResponse.headers.set("Cache-Control", "private, no-store, max-age=0");
    jsonResponse.headers.set("Vary", "Authorization, Cookie");
    return withCors(req, jsonResponse);
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;

    return withCors(
      req,
      NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Internal error",
        },
        { status },
      ),
    );
  }
}
