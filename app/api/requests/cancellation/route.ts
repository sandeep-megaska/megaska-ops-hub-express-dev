import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { prisma } from "../../../../services/db/prisma";
import { getAuthenticatedCustomer } from "../../../../services/exchange/auth";
import { evaluateCancellationEligibility, isCancellationStatusBlocking } from "../../../../services/exchange/cancellation";
import { sendCancellationRequestCreatedEmail } from "../../../../services/notifications/cancellation";
import { getShopByDomain, normalizeShopDomain, resolveShopConfig } from "../../../../services/shopify/shop";



async function resolveTrustedCancellationStatus(input: {
  shopId: string;
  customerProfileId: string;
  orderNumber: string;
  shopifyOrderId?: string | null;
}) {
  const order = await prisma.megaskaOrder.findFirst({
    where: {
      shopId: input.shopId,
      customerProfileId: input.customerProfileId,
      OR: [
        ...(input.shopifyOrderId ? [{ shopifyOrderId: input.shopifyOrderId }] : []),
        { shopifyOrderName: input.orderNumber.startsWith("#") ? input.orderNumber : `#${input.orderNumber}` },
      ],
    },
    select: {
      status: true,
      shipments: {
        orderBy: [{ statusUpdatedAt: "desc" }, { updatedAt: "desc" }],
        select: { normalizedStatus: true },
        take: 1,
      },
    },
  });

  if (!order) return null;

  return {
    fulfillmentStatus: order.shipments[0]?.normalizedStatus || order.status || null,
    financialStatus: null,
    orderCancelled: order.status === "CANCELLED",
  };
}

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthenticatedCustomer(req);
    if (!session) {
      return withCors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const orderNumber = String(body?.orderNumber || "").trim();
    const shopifyOrderId = String(body?.shopifyOrderId || "").trim() || null;
    const reason = String(body?.reason || "").trim();
    const customerNote = String(body?.customerNote || "").trim() || null;
    const fulfillmentStatus = String(body?.fulfillmentStatus || "").trim() || null;
    const financialStatus = String(body?.financialStatus || "").trim() || null;
    const amountSnapshot = String(body?.orderAmountSnapshot || "").trim() || null;

    if (!orderNumber || !reason) {
      return withCors(req, NextResponse.json({ error: "orderNumber and reason are required" }, { status: 400 }));
    }

    const requestedShopDomain = normalizeShopDomain(req.headers.get("x-shopify-shop-domain") || "");
    const resolvedShop = requestedShopDomain ? await getShopByDomain(requestedShopDomain) : await resolveShopConfig();
    const effectiveShopId = session.customer.shopId || resolvedShop?.id || null;
    if (!effectiveShopId) {
      return withCors(req, NextResponse.json({ error: "Unable to resolve shop context for cancellation request." }, { status: 400 }));
    }

    const trustedStatus = await resolveTrustedCancellationStatus({
      shopId: effectiveShopId,
      customerProfileId: session.customer.id,
      orderNumber,
      shopifyOrderId,
    });

    const eligibility = evaluateCancellationEligibility({
      fulfillmentStatus: trustedStatus?.fulfillmentStatus ?? fulfillmentStatus,
      financialStatus: trustedStatus?.financialStatus ?? financialStatus,
      orderCancelled: trustedStatus?.orderCancelled ?? Boolean(body?.orderCancelled),
    });

    if (!eligibility.eligible) {
      return withCors(req, NextResponse.json({ error: eligibility.reason }, { status: 400 }));
    }

    const existingBlockingRequest = await prisma.orderActionRequest.findFirst({
      where: {
        customerProfileId: session.customer.id,
        shopId: effectiveShopId,
        requestType: "CANCELLATION",
        orderNumber,
        status: { in: ["OPEN", "APPROVED", "CLOSED"] },
      },
      select: { id: true, status: true },
    });

    if (existingBlockingRequest && isCancellationStatusBlocking(existingBlockingRequest.status)) {
      const status = String(existingBlockingRequest.status || "").trim().toUpperCase();
      const error =
        status === "CLOSED"
          ? "Order cancellation is already finalized for this order."
          : "A cancellation request already exists for this order.";

      return withCors(
        req,
        NextResponse.json({ error }, { status: 400 })
      );
    }

    const created = await prisma.orderActionRequest.create({
      data: {
        requestType: "CANCELLATION",
        customerProfileId: session.customer.id,
        shopId: effectiveShopId,
        shopifyCustomerId: session.customer.shopifyCustomerId || null,
        shopifyOrderId,
        orderNumber,
        status: "OPEN",
        reason,
        customerNote,
        customerNameSnapshot:
          `${session.customer.firstName || ""} ${session.customer.lastName || ""}`.trim() ||
          session.customer.fullName ||
          null,
        customerPhoneSnapshot: session.customer.phoneE164,
        customerEmailSnapshot: session.customer.email,
        orderAmountSnapshot: amountSnapshot,
        eligibilityDecision: eligibility.eligible ? "ELIGIBLE" : "REJECTED",
        eligibilityReason: eligibility.reason,
      },
      include: {
        items: true,
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    try {
      await sendCancellationRequestCreatedEmail({
        requestId: created.id,
        orderNumber: created.orderNumber,
        status: created.status,
        customerName: created.customerNameSnapshot,
        customerPhone: created.customerPhoneSnapshot,
        customerEmail: created.customerEmailSnapshot,
        reason: created.reason,
      });
    } catch (error) {
      console.error("[CANCELLATION NOTIFY] Route-level send failed", {
        requestId: created.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    return withCors(req, NextResponse.json({ request: created }, { status: 201 }));
  } catch (error) {
    return withCors(
      req,
      NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 })
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthenticatedCustomer(req);
    if (!session) {
      return withCors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }

    const status = req.nextUrl.searchParams.get("status")?.trim() || undefined;

    const requests = await prisma.orderActionRequest.findMany({
      where: {
        customerProfileId: session.customer.id,
        requestType: "CANCELLATION",
        ...(status ? { status: status as never } : {}),
      },
      include: {
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        shipments: true,
      },
      orderBy: { requestedAt: "desc" },
    });

    return withCors(req, NextResponse.json({ requests }));
  } catch (error) {
    return withCors(
      req,
      NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 })
    );
  }
}
