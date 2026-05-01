import { CourierProvider, MegaskaOrderStatus } from "../../generated/prisma";

export type CourierTrackingEvent = {
  occurredAt: Date;
  normalizedStatus: MegaskaOrderStatus;
  rawStatus?: string | null;
  description?: string | null;
  location?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CourierTrackingSnapshot = {
  provider: CourierProvider;
  providerReference?: string | null;
  awb?: string | null;
  trackingUrl?: string | null;
  normalizedStatus: MegaskaOrderStatus;
  rawStatus?: string | null;
  statusUpdatedAt?: Date | null;
  events: CourierTrackingEvent[];
  metadata?: Record<string, unknown> | null;
};

export interface CourierAdapter {
  provider: CourierProvider;
  fetchTracking(input: { awb?: string | null; providerReference?: string | null }): Promise<CourierTrackingSnapshot | null>;
}

export class CourierService {
  constructor(private readonly adapters: CourierAdapter[]) {}

  async fetchTracking(input: { provider: CourierProvider; awb?: string | null; providerReference?: string | null }) {
    const adapter = this.adapters.find((candidate) => candidate.provider === input.provider);
    if (!adapter) return null;
    return adapter.fetchTracking({ awb: input.awb, providerReference: input.providerReference });
  }
}
