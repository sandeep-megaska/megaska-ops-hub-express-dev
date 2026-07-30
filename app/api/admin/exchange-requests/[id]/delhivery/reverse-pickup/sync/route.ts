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
  if (["in_transit", "in transit", "picked", "picked_up", "pickupdone", "dispatched"].some((token) => haystack.includes(token))) return "IN_TRANSIT";
  if (["ready_for_pickup", "manifested", "scheduled", "pickup created"].some((token) => haystack.includes(token))) return "SCHEDULED";
  return "PENDING";
}

function nextExchangeStatus(currentStatus: string, shipmentStatus: ShipmentStatus, rawStatus?: string | null) {
  const raw = String(rawStatus || "").toLowerCase();
  const target = shipmentStatus === "DELIVERED"
    ? "ITEM_RECEIVED"
    : shipmentStatus === "IN_TRANSIT" && ["pickup completed", "pickupdone", "picked", "picked up"].some((token) => raw.includes(token))
      ? "PICKUP_COMPLETED"
      : ["SCHEDULED", "IN_TRANSIT"].includes(shipmentStatus)
        ? "PICKUP_SCHEDULED"
        : null;

  if (!target || !canTransitionExchangeStatus(currentStatus, target)) return currentStatus;
  return target;
}

function usefulRemarks(rawStatus?: string | null, eventsCount = 0) {
  const status = rawStatus ? `Delhivery status: ${rawStatus}` : "Delhivery tracking synced";
  return eventsCount ? `${status}; events: ${eventsCount}` : status;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const request = await prisma.orderActionRequest.findFirst({
      where: { id, shopId: shop.id, requestType: "EXCHANGE" },
      include: { items: true, payments: true, shipments: true },
    });

    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const reverseShipment = request.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP" && shipment.carrier === "DELHIVERY") || null;
    if (!reverseShipment?.awb) return NextResponse.json({ error: "Delhivery reverse pickup AWB is required before syncing tracking." }, { status: 400 });

    const snapshot = await new DelhiveryAdapter().fetchTracking({ awb: reverseShipment.awb });
    if (!snapshot) return NextResponse.json({ error: "Delhivery tracking is not configured." }, { status: 503 });

    const shipmentStatus = toShipmentStatus(snapshot.rawStatus, snapshot.normalizedStatus);
    const deliveredAt = shipmentStatus === "DELIVERED" ? (snapshot.statusUpdatedAt || new Date()) : reverseShipment.deliveredAt;
    const nextStatus = nextExchangeStatus(request.status, shipmentStatus, snapshot.rawStatus);

    const result = await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipmentTracking.update({
        where: { id: reverseShipment.id },
        data: {
          status: shipmentStatus,
          deliveredAt,
          trackingUrl: snapshot.trackingUrl || reverseShipment.trackingUrl,
          remarks: usefulRemarks(snapshot.rawStatus, snapshot.events.length),
        },
      });

      const updatedRequest = nextStatus === request.status
        ? request
        : await tx.orderActionRequest.update({
            where: { id: request.id },
            data: { status: nextStatus as never },
            include: { items: true, payments: true, shipments: true },
          });

      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          eventType: "exchange.delhivery.reverse_pickup.tracking_synced",
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to sync Delhivery reverse pickup tracking." }, { status });
  }
}
