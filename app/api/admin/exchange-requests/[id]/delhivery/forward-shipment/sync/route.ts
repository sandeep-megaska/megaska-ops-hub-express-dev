import { NextRequest, NextResponse } from "next/server";
import type { ShipmentStatus } from "../../../../../../../../generated/prisma";
import { prisma } from "../../../../../../../../services/db/prisma";
import { canTransitionExchangeStatus } from "../../../../../../../../services/exchange/lifecycle";
import { DelhiveryAdapter, DelhiveryTrackingError } from "../../../../../../../../services/logistics/delhivery-adapter";
import { ShopResolutionError } from "../../../../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../../../../services/shopify/admin-auth";

function toShipmentStatus(rawStatus: string | null | undefined, normalizedStatus: string): ShipmentStatus {
  const haystack = `${rawStatus || ""} ${normalizedStatus}`.toLowerCase();
  if (["failed", "cancelled", "canceled", "exception", "delivery_failed"].some((token) => haystack.includes(token))) return "FAILED";
  if (["delivered", "received"].some((token) => haystack.includes(token))) return "DELIVERED";
  if (["out_for_delivery", "out for delivery", "in_transit", "in transit", "picked", "picked_up", "dispatched"].some((token) => haystack.includes(token))) return "IN_TRANSIT";
  if (["ready_for_pickup", "manifested", "scheduled"].some((token) => haystack.includes(token))) return "SCHEDULED";
  return "PENDING";
}

function nextExchangeStatus(currentStatus: string, shipmentStatus: ShipmentStatus) {
  const target = shipmentStatus === "DELIVERED"
    ? "CLOSED"
    : ["SCHEDULED", "IN_TRANSIT"].includes(shipmentStatus)
      ? "REPLACEMENT_SHIPPED"
      : null;

  if (!target || !canTransitionExchangeStatus(currentStatus, target)) return currentStatus;
  return target;
}

function usefulRemarks(rawStatus?: string | null, eventsCount = 0) {
  const status = rawStatus ? `Delhivery status: ${rawStatus}` : "Delhivery replacement tracking synced";
  return eventsCount ? `${status}; events: ${eventsCount}` : status;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const request = await prisma.orderActionRequest.findFirst({
      where: { id, shopId: shop.id, requestType: "EXCHANGE" },
      include: { customerProfile: true, items: true, payments: true, shipments: true },
    });

    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const forwardShipment = request.shipments.find((shipment) => shipment.direction === "FORWARD_REPLACEMENT" && shipment.carrier === "DELHIVERY") || null;
    if (!forwardShipment?.awb) return NextResponse.json({ error: "Delhivery replacement shipment AWB is required before syncing tracking." }, { status: 400 });

    const snapshot = await new DelhiveryAdapter().fetchTracking({ awb: forwardShipment.awb });
    if (!snapshot) return NextResponse.json({ error: "Delhivery tracking is not configured." }, { status: 503 });

    const shipmentStatus = toShipmentStatus(snapshot.rawStatus, snapshot.normalizedStatus);
    const statusTimestamp = snapshot.statusUpdatedAt || new Date();
    const shippedAt = ["SCHEDULED", "IN_TRANSIT", "DELIVERED"].includes(shipmentStatus) && !forwardShipment.shippedAt
      ? statusTimestamp
      : forwardShipment.shippedAt;
    const deliveredAt = shipmentStatus === "DELIVERED" ? statusTimestamp : forwardShipment.deliveredAt;
    const nextStatus = nextExchangeStatus(request.status, shipmentStatus);

    const result = await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipmentTracking.update({
        where: { id: forwardShipment.id },
        data: {
          status: shipmentStatus,
          trackingUrl: snapshot.trackingUrl || forwardShipment.trackingUrl,
          shippedAt,
          deliveredAt,
          remarks: usefulRemarks(snapshot.rawStatus, snapshot.events.length),
        },
      });

      const updatedRequest = nextStatus === request.status
        ? request
        : await tx.orderActionRequest.update({
            where: { id: request.id },
            data: { status: nextStatus as never },
            include: { customerProfile: true, items: true, payments: true, shipments: true },
          });

      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          eventType: "exchange.delhivery.forward_shipment.tracking_synced",
          entityType: "OrderActionRequest",
          entityId: request.id,
          payload: { shopId: shop.id, shipmentId: shipment.id, awb: shipment.awb, snapshot } as never,
        },
      });

      return { request: updatedRequest, shipment, tracking: snapshot };
    });

    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : error instanceof DelhiveryTrackingError ? error.statusCode : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to sync Delhivery replacement shipment tracking." }, { status });
  }
}
