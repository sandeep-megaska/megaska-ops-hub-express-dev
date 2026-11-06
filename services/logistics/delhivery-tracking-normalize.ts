// Pure parsing of Delhivery's tracking API response (no I/O), shared by the adapter
// and testable on its own.
import type { CourierProvider, MegaskaOrderStatus } from "../../generated/prisma/index.js";
import type { CourierTrackingEvent, CourierTrackingSnapshot } from "./courier-service.ts";

const DELHIVERY_STATUS_MAP: Record<string, MegaskaOrderStatus> = {
  Manifested: "READY_FOR_PICKUP",
  InTransit: "IN_TRANSIT",
  Dispatched: "OUT_FOR_DELIVERY", // Delhivery: out with the delivery agent
  Pending: "PROCESSING",
  OutForDelivery: "OUT_FOR_DELIVERY",
  Delivered: "DELIVERED",
  RTO: "RTO_INITIATED",
  RTODelivered: "RTO_DELIVERED",
  Cancelled: "CANCELLED",
};

function clean(value: unknown) {
  return String(value || "").trim();
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

export function normalizeDelhiveryRawStatus(rawStatus: string | null, statusType?: string | null): MegaskaOrderStatus {
  const type = clean(statusType).toUpperCase();
  const normalized = clean(rawStatus).toLowerCase().replace(/[^a-z]/g, "");
  // Delhivery's StatusType is the reliable signal: DL delivered (DTO = a return
  // delivered back to the shipper, "RTO" = an undelivered parcel back with the
  // shipper), RT returning, CN cancelled, PP pickup pending, PU picked up.
  if (type === "DL") return normalized.startsWith("rto") ? "RTO_DELIVERED" : "DELIVERED";
  if (type === "RT") return "RTO_INITIATED";
  if (type === "CN" || normalized.includes("cancel")) return "CANCELLED";
  if (type === "PP") return "READY_FOR_PICKUP";
  if (type === "PU") return "PICKED_UP";
  if (!normalized) return "PROCESSING";
  const direct = DELHIVERY_STATUS_MAP[clean(rawStatus)];
  if (direct) return direct;
  if (["notpicked", "pickupcreated", "manifested", "scheduled", "open"].some((token) => normalized.includes(token))) return "READY_FOR_PICKUP";
  if (normalized === "dto" || normalized.includes("delivered")) return normalized.startsWith("rto") ? "RTO_DELIVERED" : "DELIVERED";
  if (normalized.startsWith("rto")) return "RTO_INITIATED";
  if (["outfordelivery", "dispatched"].some((token) => normalized.includes(token))) return "OUT_FOR_DELIVERY";
  if (["pickupdone", "pickedup", "picked"].some((token) => normalized.includes(token))) return "PICKED_UP";
  if (["failed", "exception", "undelivered"].some((token) => normalized.includes(token))) return "DELIVERY_FAILED";
  return "IN_TRANSIT";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function normalizeDelhiveryTrackingResponse(rawResponse: unknown, awb: string | null, providerReference?: string | null, trackingUrlTemplate: string | null = null): CourierTrackingSnapshot {
  const shipment = findFirstObjectWithAnyKey(rawResponse, ["Scans", "Status", "status"]) || findFirstObjectWithAnyKey(rawResponse, ["ScanType", "Scan", "Instructions"]) || {};
  const rawEvents = Array.isArray((shipment as Record<string, unknown>).Scans) ? ((shipment as Record<string, unknown>).Scans as unknown[]) : [];
  const events: CourierTrackingEvent[] = rawEvents.map((event) => {
    const eventRecord = findFirstObjectWithAnyKey(event, ["Scan", "ScanType", "Status", "Instructions"]) || {};
    const eventStatus = pickFirstString(eventRecord, ["Scan", "Status", "ScanType", "Instructions"]);
    return {
      occurredAt: parseDate(pickFirstString(eventRecord, ["ScanDateTime", "StatusDateTime", "date"])) || new Date(),
      normalizedStatus: normalizeDelhiveryRawStatus(eventStatus, pickFirstString(eventRecord, ["ScanType"])),
      rawStatus: eventStatus,
      description: pickFirstString(eventRecord, ["Instructions", "Scan", "Status"]),
      location: pickFirstString(eventRecord, ["ScannedLocation", "location", "city"]),
      metadata: eventRecord,
    };
  });

  // Current status: Delhivery nests it (Shipment.Status = { Status, StatusType,
  // StatusDateTime, Instructions }); flat shapes and the latest scan are fallbacks.
  const nested = record((shipment as Record<string, unknown>).Status);
  const lastScan = rawEvents.length ? findFirstObjectWithAnyKey(rawEvents[rawEvents.length - 1], ["Scan", "ScanType"]) : null;
  const statusSource = nested || (pickFirstString(shipment, ["Status", "status"]) ? shipment : null) || lastScan || shipment;
  const rawStatus = pickFirstString(statusSource, ["Status", "status", "Scan", "ScanType", "Instructions", "status_type"]);
  const statusType = pickFirstString(statusSource, ["StatusType", "ScanType"]);
  const statusUpdatedAt = parseDate(pickFirstString(statusSource, ["StatusDateTime", "status_date_time", "ScanDateTime", "scan_date_time", "date"]));

  return {
    provider: "DELHIVERY" as CourierProvider,
    providerReference: providerReference || null,
    awb,
    trackingUrl: buildTrackingUrl(awb, trackingUrlTemplate),
    normalizedStatus: normalizeDelhiveryRawStatus(rawStatus, statusType),
    rawStatus,
    statusUpdatedAt: statusUpdatedAt || new Date(),
    events,
    metadata: { source: "delhivery-tracking-api", statusType, instructions: nested ? pickFirstString(nested, ["Instructions"]) : null, rawResponse },
  };
}

