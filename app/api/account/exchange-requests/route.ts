import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { prisma } from "../../../../services/db/prisma";
import { ShopResolutionError } from "../../../../services/shopify/shop";
import { getAuthenticatedExchangeCustomer } from "../../../../services/exchange/auth";
import { evaluateExchangeEligibility } from "../../../../services/exchange/eligibility";
import { sendExchangeRequestCreatedEmail } from "../../../../services/notifications/exchange";
import { ACTIVE_EXCHANGE_STATUSES } from "../../../../services/exchange/lifecycle";
import { getMegaskaCustomerDashboardData } from "../../../../services/shopify/dashboard";

function normalizeOrderNumber(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed.startsWith("#") ? trimmed : trimmed ? `#${trimmed}` : "";
}

async function resolveTrustedFulfillment(input: {
  shopId: string;
  shopDomain: string;
  customerProfileId: string;
  customerShopifyId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  orderNumber: string;
  shopifyOrderId?: string | null;
}) {
  const targetOrderNumber = normalizeOrderNumber(input.orderNumber);

  const localOrder = await prisma.megaskaOrder.findFirst({
    where: {
      shopId: input.shopId,
      customerProfileId: input.customerProfileId,
      OR: [
        ...(input.shopifyOrderId ? [{ shopifyOrderId: input.shopifyOrderId }] : []),
        ...(targetOrderNumber ? [{ shopifyOrderName: targetOrderNumber }] : []),
      ],
    },
    select: {
      status: true,
      statusUpdatedAt: true,
      shipments: {
        orderBy: [{ statusUpdatedAt: "desc" }, { updatedAt: "desc" }],
        select: {
          normalizedStatus: true,
          statusUpdatedAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (localOrder) {
    const deliveredShipment = localOrder.shipments.find(
      (shipment) => shipment.normalizedStatus === "DELIVERED"
    );
    if (deliveredShipment) {
      return {
        deliveredAt: (deliveredShipment.statusUpdatedAt || deliveredShipment.updatedAt).toISOString(),
        fulfillmentStatus: "delivered",
      };
    }

    if (localOrder.status === "DELIVERED") {
      return {
        deliveredAt: localOrder.statusUpdatedAt?.toISOString() || null,
        fulfillmentStatus: "delivered",
      };
    }

    return {
      deliveredAt: null,
      fulfillmentStatus: localOrder.status.toLowerCase(),
    };
  }

  try {
    const dashboard = await getMegaskaCustomerDashboardData({
      shopDomain: input.shopDomain,
      customerId: input.customerShopifyId,
      email: input.customerEmail,
      phoneE164: input.customerPhone,
    });

    const matchingOrder =
      dashboard?.recentOrders.find((order) => {
        const matchesById = Boolean(input.shopifyOrderId && order.shopifyOrderId === input.shopifyOrderId);
        const matchesByName = Boolean(
          targetOrderNumber && normalizeOrderNumber(order.name) === targetOrderNumber
        );
        return matchesById || matchesByName;
      }) || null;

    if (matchingOrder) {
      return {
        deliveredAt: matchingOrder.deliveredAt || null,
        fulfillmentStatus: matchingOrder.fulfillmentStatus || null,
      };
    }
  } catch (error) {
    console.warn("[EXCHANGE ELIGIBILITY] Shopify fallback lookup failed", {
      orderNumber: input.orderNumber,
      shopifyOrderId: input.shopifyOrderId || null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthenticatedExchangeCustomer(req);
    if (!auth) {
      return withCors(
        req,
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
    }

    const { shop, session } = auth;
    const customer = session.customer;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const orderNumber = String(body?.orderNumber || "").trim();
    const shopifyOrderId = String(body?.shopifyOrderId || "").trim() || null;
    const productTitle = String(body?.productTitle || "").trim();
    const variantTitle = String(body?.variantTitle || "").trim() || null;
    const requestedSize = String(body?.requestedSize || "").trim();
    const currentSize = String(body?.currentSize || "").trim() || null;
    const reason = String(body?.reason || "").trim();
    const customerNote = String(body?.customerNote || "").trim() || null;
    const deliveredAtRaw = String(body?.deliveredAt || "").trim() || null;
    const fulfilledAtRaw = String(body?.fulfilledAt || "").trim() || null;
    const effectiveDeliveredAt = deliveredAtRaw || fulfilledAtRaw;
    const fulfillmentStatus = String(body?.fulfillmentStatus || "").trim() || null;
    const quantity = Number(body?.quantity || 1);
    const amountSnapshot = String(body?.orderAmountSnapshot || "").trim() || null;
    const shopifyLineItemId = String(body?.shopifyLineItemId || "").trim() || null;
    const sku = String(body?.sku || "").trim() || null;

    if (!orderNumber || !productTitle || !requestedSize) {
      return withCors(
        req,
        NextResponse.json({ error: "Missing required fields" }, { status: 400 })
      );
    }

    const trustedFulfillment = await resolveTrustedFulfillment({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      customerProfileId: customer.id,
      customerShopifyId: customer.shopifyCustomerId,
      customerEmail: customer.email,
      customerPhone: customer.phoneE164,
      orderNumber,
      shopifyOrderId,
    });

    const resolvedDeliveredAt =
      trustedFulfillment?.deliveredAt ?? effectiveDeliveredAt;
    const resolvedFulfillmentStatus =
      trustedFulfillment?.fulfillmentStatus ?? fulfillmentStatus;

    const eligibility = evaluateExchangeEligibility({
      requestedSize,
      currentSize,
      productTitle,
      variantTitle,
      reason,
      deliveredAt: resolvedDeliveredAt,
      fulfillmentStatus: resolvedFulfillmentStatus,
    });

    if (eligibility.blocked) {
      return withCors(
        req,
        NextResponse.json({ error: eligibility.reason }, { status: 400 })
      );
    }

    const existingActiveRequest = await prisma.orderActionRequest.findFirst({
      where: {
        shopId: shop.id,
        customerProfileId: customer.id,
        requestType: "EXCHANGE",
        orderNumber,
        status: { in: [...ACTIVE_EXCHANGE_STATUSES] },
        items: {
          some: {
            ...(shopifyLineItemId
              ? { shopifyLineItemId }
              : {
                  productTitle: {
                    equals: productTitle,
                    mode: "insensitive" as const,
                  },
                  ...(variantTitle
                    ? {
                        variantTitle: {
                          equals: variantTitle,
                          mode: "insensitive" as const,
                        },
                      }
                    : {}),
                }),
          },
        },
      },
      select: { id: true },
    });

    if (existingActiveRequest) {
      return withCors(
        req,
        NextResponse.json(
          { error: "An exchange request already exists for this order." },
          { status: 400 }
        )
      );
    }

    const initialStatus = "OPEN";

    const created = await prisma.orderActionRequest.create({
      data: {
        shopId: shop.id,
        requestType: "EXCHANGE",
        customerProfileId: customer.id,
        shopifyCustomerId: customer.shopifyCustomerId || null,
        shopifyOrderId,
        orderNumber,
        status: initialStatus,
        reason,
        customerNote,
        customerNameSnapshot:
          `${customer.firstName || ""} ${customer.lastName || ""}`.trim() ||
          customer.fullName ||
          null,
        customerPhoneSnapshot: customer.phoneE164,
        customerEmailSnapshot: customer.email,
        orderAmountSnapshot: amountSnapshot,
        deliveryDateSnapshot: resolvedDeliveredAt
          ? new Date(resolvedDeliveredAt)
          : null,
        eligibilityDecision: eligibility.decision,
        eligibilityReason: eligibility.reason,
        items: {
          create: {
            shopifyLineItemId,
            productTitle,
            variantTitle,
            sku,
            currentSize,
            requestedSize,
            quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
            isClearance: eligibility.reason.toLowerCase().includes("clearance"),
            isExcludedCategory: eligibility.reason
              .toLowerCase()
              .includes("category"),
            eligibilitySnapshot: eligibility,
          },
        },
      },
      include: {
        items: true,
        payments: true,
      },
    });

    try {
      await sendExchangeRequestCreatedEmail({
        requestId: created.id,
        customerName: created.customerNameSnapshot,
        customerPhone: created.customerPhoneSnapshot,
        customerEmail: created.customerEmailSnapshot,
        orderNumber: created.orderNumber,
        itemTitle: created.items[0]?.productTitle || productTitle,
        currentSize: created.items[0]?.currentSize || currentSize,
        requestedSize: created.items[0]?.requestedSize || requestedSize,
        customerNote: created.customerNote,
        status: created.status,
      });
    } catch (error) {
      console.error("[EXCHANGE NOTIFY] Route-level send failed", {
        requestId: created.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    return withCors(
      req,
      NextResponse.json(
        {
          request: created,
          stockReviewMessage:
            eligibility.stockReviewMessage ||
            "Exchange approval depends on the availability of the requested size. If unavailable, our team will contact you with next steps.",
        },
        { status: 201 }
      )
    );
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;

    return withCors(
      req,
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed" },
        { status }
      )
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedExchangeCustomer(req);
    if (!auth) {
      return withCors(
        req,
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
    }

    const { shop, session } = auth;
    const status = req.nextUrl.searchParams.get("status")?.trim() || undefined;

    const requests = await prisma.orderActionRequest.findMany({
      where: {
        shopId: shop.id,
        customerProfileId: session.customer.id,
        requestType: "EXCHANGE",
        ...(status ? { status: status as never } : {}),
      },
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        shipments: true,
      },
      orderBy: { requestedAt: "desc" },
    });

    const hydratedRequests = requests.map((request) => {
      const latestPayment = request.payments[0] || null;
      const canPayReversePickup =
        request.status === "AWAITING_PAYMENT" &&
        latestPayment?.purpose === "REVERSE_PICKUP_FEE" &&
        latestPayment.status !== "PAID";

      return {
        ...request,
        canPayReversePickup,
        paymentActionEndpoint: canPayReversePickup
          ? `/api/account/exchange-requests/${request.id}/payment-link`
          : null,
      };
    });

    return withCors(req, NextResponse.json({ requests: hydratedRequests }));
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;

    return withCors(
      req,
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed" },
        { status }
      )
    );
  }
}
