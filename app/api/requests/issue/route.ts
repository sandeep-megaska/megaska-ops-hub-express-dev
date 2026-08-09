import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { prisma } from "../../../../services/db/prisma";
import { getAuthenticatedCustomer } from "../../../../services/exchange/auth";
import { evaluateIssueEligibility } from "../../../../services/exchange/issue";
import { getRequestWindowDays } from "../../../../services/loopdesk/merchant-settings";
import { sendIssueRequestCreatedEmail } from "../../../../services/notifications/issue";
import {
  findActiveRequest,
  formatRequestLockReason,
  orderNumberVariants,
} from "../../../../services/exchange/request-interlocks";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

async function resolveTrustedIssueFulfillment(input: {
  shopId?: string | null;
  customerProfileId: string;
  orderNumber: string;
  shopifyOrderId?: string | null;
}) {
  if (!input.shopId) return null;

  const order = await prisma.megaskaOrder.findFirst({
    where: {
      shopId: input.shopId,
      customerProfileId: input.customerProfileId,
      OR: [
        ...(input.shopifyOrderId
          ? [{ shopifyOrderId: input.shopifyOrderId }]
          : []),
        ...orderNumberVariants(input.orderNumber).map((shopifyOrderName) => ({
          shopifyOrderName,
        })),
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

  if (!order) return null;

  const deliveredShipment = order.shipments.find(
    (shipment) => shipment.normalizedStatus === "DELIVERED",
  );
  if (deliveredShipment) {
    return {
      fulfillmentStatus: "delivered",
      deliveredAt: (
        deliveredShipment.statusUpdatedAt || deliveredShipment.updatedAt
      ).toISOString(),
    };
  }

  return {
    fulfillmentStatus:
      order.status?.toLowerCase() ||
      order.shipments[0]?.normalizedStatus?.toLowerCase() ||
      null,
    deliveredAt:
      order.status === "DELIVERED"
        ? order.statusUpdatedAt?.toISOString() || null
        : null,
  };
}

function sanitizeUrls(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthenticatedCustomer(req);
    if (!session) {
      return withCors(
        req,
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const orderNumber = String(body?.orderNumber || "").trim();
    const shopifyOrderId = String(body?.shopifyOrderId || "").trim() || null;
    const productTitle = String(body?.productTitle || "").trim();
    const variantTitle = String(body?.variantTitle || "").trim() || null;
    const shopifyLineItemId =
      String(body?.shopifyLineItemId || "").trim() || null;
    const issueReason = String(body?.reason || "").trim();
    const customerDescription = String(body?.customerNote || "").trim() || null;
    const fulfillmentStatus =
      String(body?.fulfillmentStatus || "").trim() || null;
    const amountSnapshot =
      String(body?.orderAmountSnapshot || "").trim() || null;
    const paymentGatewayName =
      String(body?.paymentGatewayName || "").trim() || null;
    const declaredUnused = Boolean(body?.declaredUnused);
    const declaredUnwashed = Boolean(body?.declaredUnwashed);
    const declaredTagsIntact = Boolean(body?.declaredTagsIntact);
    const imageEvidenceUrls = sanitizeUrls(body?.imageEvidenceUrls);
    const videoEvidenceUrls = sanitizeUrls(body?.videoEvidenceUrls);

    if (!orderNumber || !issueReason || !productTitle) {
      return withCors(
        req,
        NextResponse.json(
          { error: "orderNumber, reason, and productTitle are required" },
          { status: 400 },
        ),
      );
    }

    const trustedFulfillment = await resolveTrustedIssueFulfillment({
      shopId: session.customer.shopId,
      customerProfileId: session.customer.id,
      orderNumber,
      shopifyOrderId,
    });
    const resolvedFulfillmentStatus =
      trustedFulfillment?.fulfillmentStatus ?? fulfillmentStatus;
    const resolvedDeliveredAt = trustedFulfillment?.deliveredAt ?? null;

    const windowDays = session.customer.shopId
      ? await getRequestWindowDays(session.customer.shopId)
      : 5;
    const eligibility = evaluateIssueEligibility({
      fulfillmentStatus: resolvedFulfillmentStatus,
      deliveredAt: resolvedDeliveredAt,
      fulfilledAt: null,
      declaredUnused,
      declaredUnwashed,
      declaredTagsIntact,
      windowDays,
    });

    if (!eligibility.eligible) {
      return withCors(
        req,
        NextResponse.json({ error: eligibility.reason }, { status: 400 }),
      );
    }

    const existingRequests = await prisma.orderActionRequest.findMany({
      where: {
        customerProfileId: session.customer.id,
        ...(session.customer.shopId ? { shopId: session.customer.shopId } : {}),
        requestType: { in: ["CANCELLATION", "EXCHANGE", "ISSUE"] },
        orderNumber: { in: orderNumberVariants(orderNumber) },
      },
      orderBy: { requestedAt: "desc" },
      select: { id: true, requestType: true, status: true },
    });
    const activeRequest = findActiveRequest(existingRequests);

    if (activeRequest) {
      const error =
        activeRequest.requestType === "ISSUE"
          ? "An active issue request already exists for this order."
          : `Cannot report an issue while ${formatRequestLockReason(activeRequest)?.toLowerCase()}`;

      return withCors(req, NextResponse.json({ error }, { status: 400 }));
    }

    const effectiveDeliveredAt = resolvedDeliveredAt;

    const created = await prisma.orderActionRequest.create({
      data: {
        requestType: "ISSUE",
        customerProfileId: session.customer.id,
        shopId: session.customer.shopId || undefined,
        shopifyCustomerId: session.customer.shopifyCustomerId || null,
        shopifyOrderId,
        orderNumber,
        status: "OPEN",
        reason: issueReason,
        customerNote: customerDescription,
        customerNameSnapshot:
          `${session.customer.firstName || ""} ${session.customer.lastName || ""}`.trim() ||
          session.customer.fullName ||
          null,
        customerPhoneSnapshot: session.customer.phoneE164,
        customerEmailSnapshot: session.customer.email,
        orderAmountSnapshot: amountSnapshot,
        deliveryDateSnapshot: effectiveDeliveredAt
          ? new Date(effectiveDeliveredAt)
          : null,
        eligibilityDecision: eligibility.eligible ? "ELIGIBLE" : "REJECTED",
        eligibilityReason: eligibility.reason,
        items: {
          create: {
            shopifyLineItemId,
            productTitle,
            variantTitle,
            requestedSize: "N/A",
            quantity: 1,
            eligibilitySnapshot: {
              issueCategory: issueReason,
              declarations: {
                declaredUnused,
                declaredUnwashed,
                declaredTagsIntact,
              },
              evidence: {
                imageEvidenceUrls,
                videoEvidenceUrls,
              },
              paymentGatewayName,
            },
          },
        },
      },
      include: {
        items: true,
      },
    });

    try {
      await sendIssueRequestCreatedEmail({
        shopId: created.shopId || "",
        requestId: created.id,
        orderNumber: created.orderNumber,
        status: created.status,
        customerName: created.customerNameSnapshot,
        customerPhone: created.customerPhoneSnapshot,
        customerEmail: created.customerEmailSnapshot,
        itemTitle: created.items[0]?.productTitle || productTitle,
        variantTitle: created.items[0]?.variantTitle || variantTitle,
        reason: created.reason,
        customerNote: created.customerNote,
      });
    } catch (error) {
      console.error("[ISSUE NOTIFY] Route-level send failed", {
        requestId: created.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    return withCors(
      req,
      NextResponse.json(
        {
          request: created,
          message:
            "Issue request submitted. Our operations team will review your evidence and update you.",
        },
        { status: 201 },
      ),
    );
  } catch (error) {
    return withCors(
      req,
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed" },
        { status: 500 },
      ),
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthenticatedCustomer(req);
    if (!session) {
      return withCors(
        req,
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }

    const status = req.nextUrl.searchParams.get("status")?.trim() || undefined;

    const requests = await prisma.orderActionRequest.findMany({
      where: {
        customerProfileId: session.customer.id,
        requestType: "ISSUE",
        ...(status ? { status: status as never } : {}),
      },
      include: {
        items: true,
      },
      orderBy: { requestedAt: "desc" },
    });

    return withCors(req, NextResponse.json({ requests }));
  } catch (error) {
    return withCors(
      req,
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed" },
        { status: 500 },
      ),
    );
  }
}
