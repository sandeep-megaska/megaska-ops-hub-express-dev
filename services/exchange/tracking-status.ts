// Pure mapping from a courier tracking status to the exchange shipment status and
// the next exchange-request status (used by tracking-sync.ts; no I/O).
import type { ShipmentStatus } from "../../generated/prisma/index.js";
import { canTransitionExchangeStatus } from "./lifecycle.ts";

// Shipment status from the normalized courier status (see normalizeDelhiveryRawStatus).
// A returned-to-us replacement (RTO) or a cancelled booking is FAILED; a failed
// delivery attempt is still on its way.
export function exchangeShipmentStatus(normalizedStatus: string): ShipmentStatus {
  switch (normalizedStatus) {
    case "DELIVERED":
      return "DELIVERED";
    case "CANCELLED":
    case "RTO_INITIATED":
    case "RTO_DELIVERED":
      return "FAILED";
    case "PICKED_UP":
    case "IN_TRANSIT":
    case "OUT_FOR_DELIVERY":
    case "DELIVERY_FAILED":
      return "IN_TRANSIT";
    case "READY_FOR_PICKUP":
    case "ORDER_CONFIRMED":
    case "PACKED":
      return "SCHEDULED";
    default:
      return "PENDING";
  }
}

// Walks the allowed lifecycle towards the target, so a pickup Delhivery reports as
// already returned to us (scheduled → delivered between two polls) still lands on
// "item received" via "pickup completed".
function advanceTo(currentStatus: string, path: string[]) {
  let status = currentStatus;
  for (const step of path) if (canTransitionExchangeStatus(status, step)) status = step;
  return status;
}

export function nextReverseExchangeStatus(currentStatus: string, shipmentStatus: ShipmentStatus, normalizedStatus: string) {
  if (shipmentStatus === "DELIVERED") return advanceTo(currentStatus, ["PICKUP_SCHEDULED", "PICKUP_COMPLETED", "ITEM_RECEIVED"]);
  if (shipmentStatus === "IN_TRANSIT") return advanceTo(currentStatus, ["PICKUP_SCHEDULED", "PICKUP_COMPLETED"]);
  if (shipmentStatus === "SCHEDULED" && normalizedStatus !== "ORDER_CONFIRMED") return advanceTo(currentStatus, ["PICKUP_SCHEDULED"]);
  return currentStatus;
}

export function nextForwardExchangeStatus(currentStatus: string, shipmentStatus: ShipmentStatus) {
  if (shipmentStatus === "DELIVERED") return advanceTo(currentStatus, ["REPLACEMENT_SHIPPED", "CLOSED"]);
  if (["SCHEDULED", "IN_TRANSIT"].includes(shipmentStatus)) return advanceTo(currentStatus, ["REPLACEMENT_SHIPPED"]);
  return currentStatus;
}

// Customer messages only for steps that just happened: catching up on a delivery
// from weeks ago (e.g. after a tracking fix) updates the records silently.
export const MILESTONE_NOTIFY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export function isFreshMilestone(statusAt: Date | null | undefined, now = new Date()) {
  return !statusAt || now.getTime() - statusAt.getTime() <= MILESTONE_NOTIFY_WINDOW_MS;
}

