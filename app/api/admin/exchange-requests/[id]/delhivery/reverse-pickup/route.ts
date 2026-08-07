import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../../services/db/prisma";
import { REVERSE_PICKUP_WINDOW_LOCK_REASON, isWithinReversePickupWindow } from "../../../../../../../services/exchange/deadlines";
import { canTransitionExchangeStatus } from "../../../../../../../services/exchange/lifecycle";
import { createDelhiveryReversePickup, DelhiveryReversePickupError } from "../../../../../../../services/logistics/delhivery-reverse-pickup";
import { resolveDelhiveryRuntimeConfig } from "../../../../../../../services/logistics/delhivery-runtime";
import { resolveExchangeShippingAddress } from "../../../../../../../services/exchange/pickup-address";
import { ShopResolutionError } from "../../../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../../../services/shopify/admin-auth";
import { notifyExchangeMilestone } from "../../../../../../../services/notifications/exchange-milestones";

const ELIGIBLE_STATUSES = ["PAYMENT_RECEIVED", "APPROVED", "PICKUP_PENDING"];

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const request = await prisma.orderActionRequest.findFirst({
      where: { id, shopId: shop.id, requestType: "EXCHANGE" },
      include: {
        customerProfile: true,
        items: true,
        payments: { where: { purpose: "REVERSE_PICKUP_FEE" }, orderBy: { createdAt: "desc" } },
        shipments: true,
      },
    });

    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const latestPayment = request.payments[0] || null;
    if (latestPayment?.status !== "PAID") {
      return NextResponse.json({ error: "Reverse pickup fee must be paid before creating Delhivery pickup." }, { status: 400 });
    }

    if (!ELIGIBLE_STATUSES.includes(request.status)) {
      return NextResponse.json({ error: "Exchange status is not eligible for Delhivery reverse pickup creation." }, { status: 400 });
    }

    if (!isWithinReversePickupWindow(request.deliveryDateSnapshot)) {
      return NextResponse.json({ error: REVERSE_PICKUP_WINDOW_LOCK_REASON }, { status: 400 });
    }

    const existingReverseShipment = request.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP") || null;
    if (existingReverseShipment?.awb) {
      return NextResponse.json({ request, shipment: existingReverseShipment, idempotent: true });
    }

    const runtime = await resolveDelhiveryRuntimeConfig(shop.id);
    const shippingAddress = await resolveExchangeShippingAddress(request);
    if (!shippingAddress) {
      return NextResponse.json({ error: "Could not resolve the customer's shipping address from the order." }, { status: 400 });
    }
    const delhiveryResult = await createDelhiveryReversePickup(request, runtime, shippingAddress);
    const nextStatus = canTransitionExchangeStatus(request.status, "PICKUP_SCHEDULED") ? "PICKUP_SCHEDULED" : "PICKUP_PENDING";

    const result = await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipmentTracking.upsert({
        where: { requestId_direction: { requestId: request.id, direction: "REVERSE_PICKUP" } },
        create: {
          requestId: request.id,
          direction: "REVERSE_PICKUP",
          carrier: "DELHIVERY",
          awb: delhiveryResult.awb,
          trackingUrl: delhiveryResult.trackingUrl,
          status: delhiveryResult.status,
          remarks: delhiveryResult.providerReference ? `Delhivery reference: ${delhiveryResult.providerReference}` : "Created via Delhivery API",
        },
        update: {
          carrier: "DELHIVERY",
          awb: delhiveryResult.awb,
          trackingUrl: delhiveryResult.trackingUrl,
          status: delhiveryResult.status,
          remarks: delhiveryResult.providerReference ? `Delhivery reference: ${delhiveryResult.providerReference}` : "Created via Delhivery API",
        },
      });

      const updatedRequest = await tx.orderActionRequest.update({
        where: { id: request.id },
        data: { status: nextStatus as never },
        include: { items: true, payments: true, shipments: true },
      });

      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          eventType: "exchange.delhivery.reverse_pickup.created",
          entityType: "OrderActionRequest",
          entityId: request.id,
          payload: {
            shopId: shop.id,
            shipmentId: shipment.id,
            awb: shipment.awb,
            providerReference: delhiveryResult.providerReference,
            rawResponse: delhiveryResult.rawResponse,
          } as never,
        },
      });

      return { request: updatedRequest, shipment };
    });

    // Notify customer + admin that the pickup is scheduled (idempotent).
    await notifyExchangeMilestone(request.id, result.request.status);

    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : error instanceof DelhiveryReversePickupError ? error.statusCode : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create Delhivery reverse pickup." }, { status });
  }
}
