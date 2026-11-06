import type { ShipmentStatus, ShipmentTracking } from "../../generated/prisma";
import { prisma } from "../db/prisma";
import { exchangeShipmentStatus, isFreshMilestone, nextForwardExchangeStatus, nextReverseExchangeStatus } from "./tracking-status.ts";
import { DelhiveryAdapter, DelhiveryTrackingError } from "../logistics/delhivery-adapter";
import { resolveDelhiveryRuntimeConfig } from "../logistics/delhivery-runtime";
import { notifyExchangeMilestone } from "../notifications/exchange-milestones";

// Single source of truth for turning a Delhivery tracking snapshot into a
// ShipmentTracking status + the next exchange-request status. Both the manual
// admin "Sync tracking" buttons and the scheduled cron poller call
// syncExchangeShipment() so their transitions can never drift apart.

export type ExchangeShipmentDirection = "REVERSE_PICKUP" | "FORWARD_REPLACEMENT";

interface SyncableRequest {
  id: string;
  status: string;
  shopId: string | null;
}

interface SyncableShipment {
  id: string;
  direction: string;
  carrier: string | null;
  awb: string | null;
  trackingUrl: string | null;
  deliveredAt: Date | null;
  shippedAt: Date | null;
}

function usefulRemarks(direction: ExchangeShipmentDirection, rawStatus?: string | null, eventsCount = 0) {
  const base = rawStatus
    ? `Delhivery status: ${rawStatus}`
    : direction === "REVERSE_PICKUP"
      ? "Delhivery tracking synced"
      : "Delhivery replacement tracking synced";
  return eventsCount ? `${base}; events: ${eventsCount}` : base;
}

export interface ExchangeShipmentSyncResult {
  shipment: ShipmentTracking;
  tracking: unknown;
  shipmentStatus: ShipmentStatus;
  previousExchangeStatus: string;
  nextExchangeStatus: string;
  changed: boolean;
}

/**
 * Fetch Delhivery tracking for one shipment, map it to a ShipmentStatus, advance
 * the exchange request if the transition is allowed, and persist both plus an
 * audit event — all in one transaction. Throws `DelhiveryTrackingError` when the
 * AWB is missing or tracking is not configured (callers map that to an HTTP
 * status; the cron catches it per-item). The external Delhivery call happens
 * before the transaction so a slow/failed courier call never holds it open.
 */
export async function syncExchangeShipment(
  request: SyncableRequest,
  shipment: SyncableShipment,
  opts: { actorType?: "admin" | "system" } = {},
): Promise<ExchangeShipmentSyncResult> {
  if (!shipment.awb) {
    throw new DelhiveryTrackingError("Delhivery AWB is required before syncing tracking.", 400);
  }

  const runtime = await resolveDelhiveryRuntimeConfig(request.shopId);
  const snapshot = await new DelhiveryAdapter(runtime).fetchTracking({ awb: shipment.awb });
  if (!snapshot) {
    throw new DelhiveryTrackingError("Delhivery tracking is not configured.", 503);
  }

  const isReverse = shipment.direction === "REVERSE_PICKUP";
  const shipmentStatus = exchangeShipmentStatus(snapshot.normalizedStatus);
  const statusTimestamp = snapshot.statusUpdatedAt || new Date();
  const nextStatus = isReverse
    ? nextReverseExchangeStatus(request.status, shipmentStatus, snapshot.normalizedStatus)
    : nextForwardExchangeStatus(request.status, shipmentStatus);
  const changed = nextStatus !== request.status;

  const deliveredAt = shipmentStatus === "DELIVERED" ? statusTimestamp : shipment.deliveredAt;
  const shippedAt =
    !isReverse && ["SCHEDULED", "IN_TRANSIT", "DELIVERED"].includes(shipmentStatus) && !shipment.shippedAt
      ? statusTimestamp
      : shipment.shippedAt;

  const direction: ExchangeShipmentDirection = isReverse ? "REVERSE_PICKUP" : "FORWARD_REPLACEMENT";
  const eventType = isReverse
    ? "exchange.delhivery.reverse_pickup.tracking_synced"
    : "exchange.delhivery.forward_shipment.tracking_synced";

  const updatedShipment = await prisma.$transaction(async (tx) => {
    const persisted = await tx.shipmentTracking.update({
      where: { id: shipment.id },
      data: isReverse
        ? {
            status: shipmentStatus,
            deliveredAt,
            trackingUrl: snapshot.trackingUrl || shipment.trackingUrl,
            remarks: usefulRemarks(direction, snapshot.rawStatus, snapshot.events.length),
          }
        : {
            status: shipmentStatus,
            trackingUrl: snapshot.trackingUrl || shipment.trackingUrl,
            shippedAt,
            deliveredAt,
            remarks: usefulRemarks(direction, snapshot.rawStatus, snapshot.events.length),
          },
    });

    if (changed) {
      await tx.orderActionRequest.update({
        where: { id: request.id },
        data: { status: nextStatus as never },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorType: opts.actorType ?? "system",
        eventType,
        entityType: "OrderActionRequest",
        entityId: request.id,
        payload: { shopId: request.shopId, shipmentId: persisted.id, awb: persisted.awb, snapshot } as never,
      },
    });

    return persisted;
  });

  // Notify customer + admin on an actual status transition. Idempotent per
  // (request, status), so the 30-min cron and the manual "Sync tracking" button
  // never double-notify the same milestone.
  if (changed && isFreshMilestone(snapshot.statusUpdatedAt)) {
    await notifyExchangeMilestone(request.id, nextStatus);
  } else if (changed) {
    console.info("[DELHIVERY TRACKING] milestone_not_notified_stale", { requestId: request.id, status: nextStatus, statusAt: snapshot.statusUpdatedAt });
  }

  return {
    shipment: updatedShipment,
    tracking: snapshot,
    shipmentStatus,
    previousExchangeStatus: request.status,
    nextExchangeStatus: nextStatus,
    changed,
  };
}
