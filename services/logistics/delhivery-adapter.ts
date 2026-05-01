import { CourierProvider, MegaskaOrderStatus } from "../../generated/prisma";
import { getDelhiveryCapabilityState } from "./delhivery";
import type { CourierAdapter, CourierTrackingSnapshot } from "./courier-service";

const DELHIVERY_STATUS_MAP: Record<string, MegaskaOrderStatus> = {
  Manifested: "READY_FOR_PICKUP",
  InTransit: "IN_TRANSIT",
  Dispatched: "IN_TRANSIT",
  Pending: "PROCESSING",
  OutForDelivery: "OUT_FOR_DELIVERY",
  Delivered: "DELIVERED",
  RTO: "RTO_INITIATED",
  RTODelivered: "RTO_DELIVERED",
  Cancelled: "CANCELLED",
};

export class DelhiveryAdapter implements CourierAdapter {
  provider = CourierProvider.DELHIVERY;

  async fetchTracking(input: { awb?: string | null; providerReference?: string | null }): Promise<CourierTrackingSnapshot | null> {
    const capability = getDelhiveryCapabilityState();
    if (!capability.configured) return null;

    // Placeholder for existing/future Delhivery API wrapper usage.
    const rawStatus = null;
    const normalizedStatus = rawStatus ? DELHIVERY_STATUS_MAP[rawStatus] || "IN_TRANSIT" : "PROCESSING";

    return {
      provider: CourierProvider.DELHIVERY,
      providerReference: input.providerReference || null,
      awb: input.awb || null,
      normalizedStatus,
      rawStatus,
      statusUpdatedAt: new Date(),
      events: [],
      metadata: { source: "delhivery-adapter-placeholder" },
    };
  }
}
