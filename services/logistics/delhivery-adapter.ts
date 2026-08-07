import { CourierProvider, MegaskaOrderStatus } from "../../generated/prisma";
import { buildEnvDelhiveryRuntimeConfig, type DelhiveryRuntimeConfig } from "./delhivery-runtime";
import type { CourierAdapter, CourierTrackingEvent, CourierTrackingSnapshot } from "./courier-service";

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

export class DelhiveryTrackingError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "DelhiveryTrackingError";
    this.statusCode = statusCode;
  }
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function resolveTrackingEndpoint(runtime: DelhiveryRuntimeConfig, awb: string) {
  const baseUrl = runtime.baseUrl.replace(/\/+$/, "");
  const path = runtime.trackingPath;
  const endpoint = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const url = new URL(endpoint);
  if (!url.searchParams.has("waybill") && !url.searchParams.has("awb")) {
    url.searchParams.set("waybill", awb);
  }
  return url.toString();
}

function buildTrackingUrl(awb: string | null, template: string | null) {
  if (!awb) return null;
  if (template) return template.replace("{awb}", encodeURIComponent(awb));
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}

function findFirstObjectWithAnyKey(source: unknown, keys: string[]): Record<string, unknown> | null {
  if (!source || typeof source !== "object") return null;
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = findFirstObjectWithAnyKey(item, keys);
      if (found) return found;
    }
    return null;
  }
  const record = source as Record<string, unknown>;
  if (keys.some((key) => key in record)) return record;
  for (const value of Object.values(record)) {
    const found = findFirstObjectWithAnyKey(value, keys);
    if (found) return found;
  }
  return null;
}

function pickFirstString(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const cleaned = clean(value);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function parseDate(value: unknown) {
  const cleaned = clean(value);
  if (!cleaned) return null;
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeDelhiveryRawStatus(rawStatus: string | null): MegaskaOrderStatus {
  if (!rawStatus) return "PROCESSING";
  const direct = DELHIVERY_STATUS_MAP[rawStatus];
  if (direct) return direct;
  const normalized = rawStatus.toLowerCase().replace(/[^a-z]/g, "");
  if (["pickupcreated", "manifested", "pending", "scheduled"].some((token) => normalized.includes(token))) return "READY_FOR_PICKUP";
  if (["intransit", "picked", "pickupdone", "pickedup", "dispatched"].some((token) => normalized.includes(token))) return "IN_TRANSIT";
  if (["delivered", "received"].some((token) => normalized.includes(token))) return "DELIVERED";
  if (["failed", "cancelled", "canceled", "exception"].some((token) => normalized.includes(token))) return rawStatus.toLowerCase().includes("cancel") ? "CANCELLED" : "DELIVERY_FAILED";
  return "IN_TRANSIT";
}

export function normalizeDelhiveryTrackingResponse(rawResponse: unknown, awb: string | null, providerReference?: string | null, trackingUrlTemplate: string | null = null): CourierTrackingSnapshot {
  const shipment = findFirstObjectWithAnyKey(rawResponse, ["Status", "status", "ScanType", "Scan", "Instructions"]) || {};
  const rawStatus = pickFirstString(shipment, ["Status", "status", "ScanType", "Scan", "Instructions", "status_type"]);
  const statusUpdatedAt = parseDate(pickFirstString(shipment, ["StatusDateTime", "status_date_time", "date", "ScanDateTime", "scan_date_time"]));
  const rawEvents = Array.isArray((shipment as Record<string, unknown>).Scans) ? ((shipment as Record<string, unknown>).Scans as unknown[]) : [];
  const events: CourierTrackingEvent[] = rawEvents.map((event) => {
    const eventRecord = findFirstObjectWithAnyKey(event, ["Scan", "ScanType", "Status", "Instructions"]) || {};
    const eventStatus = pickFirstString(eventRecord, ["Scan", "ScanType", "Status", "Instructions"]);
    return {
      occurredAt: parseDate(pickFirstString(eventRecord, ["ScanDateTime", "StatusDateTime", "date"])) || new Date(),
      normalizedStatus: normalizeDelhiveryRawStatus(eventStatus),
      rawStatus: eventStatus,
      description: pickFirstString(eventRecord, ["Instructions", "Scan", "Status"]),
      location: pickFirstString(eventRecord, ["ScannedLocation", "location", "city"]),
      metadata: eventRecord,
    };
  });

  return {
    provider: CourierProvider.DELHIVERY,
    providerReference: providerReference || null,
    awb,
    trackingUrl: buildTrackingUrl(awb, trackingUrlTemplate),
    normalizedStatus: normalizeDelhiveryRawStatus(rawStatus),
    rawStatus,
    statusUpdatedAt: statusUpdatedAt || new Date(),
    events,
    metadata: { source: "delhivery-tracking-api", rawResponse },
  };
}

export class DelhiveryAdapter implements CourierAdapter {
  provider = CourierProvider.DELHIVERY;

  // Optional per-shop runtime config; falls back to env for any legacy/no-shop
  // caller (e.g. a generic CourierService path).
  constructor(private readonly runtime?: DelhiveryRuntimeConfig) {}

  async fetchTracking(input: { awb?: string | null; providerReference?: string | null }): Promise<CourierTrackingSnapshot | null> {
    const runtime = this.runtime ?? buildEnvDelhiveryRuntimeConfig();
    if (!runtime.configured) return null;
    const awb = clean(input.awb);
    if (!awb) throw new DelhiveryTrackingError("AWB is required to fetch Delhivery tracking.", 400);

    const response = await fetch(resolveTrackingEndpoint(runtime, awb), {
      method: "GET",
      headers: { Authorization: `Token ${runtime.apiToken}`, Accept: "application/json" },
    });
    const rawText = await response.text();
    let rawResponse: unknown = rawText;
    try {
      rawResponse = rawText ? JSON.parse(rawText) : null;
    } catch {
      rawResponse = { raw: rawText };
    }

    if (!response.ok) throw new DelhiveryTrackingError(`Delhivery tracking API returned HTTP ${response.status}.`, 502);
    return normalizeDelhiveryTrackingResponse(rawResponse, awb, input.providerReference, runtime.trackingUrlTemplate);
  }
}
