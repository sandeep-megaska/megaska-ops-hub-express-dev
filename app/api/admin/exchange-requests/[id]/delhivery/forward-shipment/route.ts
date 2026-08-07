import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../../services/db/prisma";
import { canTransitionExchangeStatus } from "../../../../../../../services/exchange/lifecycle";
import { createDelhiveryForwardShipment, DelhiveryForwardShipmentError } from "../../../../../../../services/logistics/delhivery-forward-shipment";
import { resolveDelhiveryRuntimeConfig } from "../../../../../../../services/logistics/delhivery-runtime";
import { ShopResolutionError } from "../../../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../../../services/shopify/admin-auth";

const ELIGIBLE_STATUSES = ["ITEM_RECEIVED", "REPLACEMENT_PROCESSING"];

function resolveNextStatus(currentStatus: string, hasAwb: boolean) {
  if (!hasAwb) {
    return canTransitionExchangeStatus(currentStatus, "REPLACEMENT_PROCESSING") ? "REPLACEMENT_PROCESSING" : currentStatus;
  }

  if (canTransitionExchangeStatus(currentStatus, "REPLACEMENT_SHIPPED")) return "REPLACEMENT_SHIPPED";
  if (
    currentStatus === "ITEM_RECEIVED"
    && canTransitionExchangeStatus(currentStatus, "REPLACEMENT_PROCESSING")
    && canTransitionExchangeStatus("REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED")
  ) {
    return "REPLACEMENT_SHIPPED";
  }

  return currentStatus;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const request = await prisma.orderActionRequest.findFirst({
      where: { id, shopId: shop.id, requestType: "EXCHANGE" },
      include: {
        customerProfile: true,
        items: true,
        payments: { orderBy: { createdAt: "desc" } },
        shipments: true,
      },
    });

    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!ELIGIBLE_STATUSES.includes(request.status)) {
      return NextResponse.json({ error: "Exchange status is not eligible for Delhivery replacement shipment creation." }, { status: 400 });
    }

    const reverseShipment = request.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP") || null;
    const reverseDelivered = reverseShipment?.status === "DELIVERED" || request.status === "ITEM_RECEIVED";
    if (!reverseDelivered) {
      return NextResponse.json({ error: "Returned item must be received before creating replacement shipment." }, { status: 400 });
    }

    const existingForwardShipment = request.shipments.find((shipment) => shipment.direction === "FORWARD_REPLACEMENT") || null;
    if (existingForwardShipment?.awb) {
      return NextResponse.json({ request, shipment: existingForwardShipment, idempotent: true });
    }

    const runtime = await resolveDelhiveryRuntimeConfig(shop.id);
    const delhiveryResult = await createDelhiveryForwardShipment(request, runtime);
    const nextStatus = resolveNextStatus(request.status, Boolean(delhiveryResult.awb));

    const result = await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipmentTracking.upsert({
        where: { requestId_direction: { requestId: request.id, direction: "FORWARD_REPLACEMENT" } },
        create: {
          requestId: request.id,
          direction: "FORWARD_REPLACEMENT",
          carrier: "DELHIVERY",
          awb: delhiveryResult.awb,
          trackingUrl: delhiveryResult.trackingUrl,
          status: delhiveryResult.status,
          shippedAt: delhiveryResult.awb ? new Date() : null,
          remarks: delhiveryResult.providerReference ? `Delhivery reference: ${delhiveryResult.providerReference}` : "Created via Delhivery API",
        },
        update: {
          carrier: "DELHIVERY",
          awb: delhiveryResult.awb,
          trackingUrl: delhiveryResult.trackingUrl,
          status: delhiveryResult.status,
          shippedAt: delhiveryResult.awb ? new Date() : null,
          remarks: delhiveryResult.providerReference ? `Delhivery reference: ${delhiveryResult.providerReference}` : "Created via Delhivery API",
        },
      });

      const updatedRequest = await tx.orderActionRequest.update({
        where: { id: request.id },
        data: nextStatus !== request.status ? { status: nextStatus as never } : {},
        include: { items: true, payments: true, shipments: true, customerProfile: true },
      });

      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          eventType: "exchange.delhivery.forward_shipment.created",
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

    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : error instanceof DelhiveryForwardShipmentError ? error.statusCode : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create Delhivery replacement shipment." }, { status });
  }
}
