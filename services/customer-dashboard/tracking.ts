import { prisma } from "../db/prisma.ts";
import { normalizeOrderNumber } from "../exchange/request-interlocks.ts";
import type { DashboardCommerceOrder } from "./commerce.ts";
import type { DashboardShipmentDirection, DashboardTrackingDto } from "./contract.ts";
import type { CustomerDashboardContext } from "./context.ts";

export type DashboardTrackingSnapshot = { available: boolean; source: "LOOPDESK_SHIPMENT" | "SHOPIFY_FULFILLMENT" | "NONE"; summary: { statusCode: string; statusLabel: string; lastUpdatedAt: Date | string | null; message: string | null }; shipments: DashboardTrackingShipmentSnapshot[] };
export type DashboardTrackingShipmentSnapshot = { id: string; direction: "FORWARD" | "REVERSE_PICKUP" | "REPLACEMENT"; carrier: string | null; awb: string | null; trackingUrl: string | null; statusCode: string; statusLabel: string; lastUpdatedAt: Date | string | null; isMock: boolean; timeline: DashboardTrackingEventSnapshot[] };
export type DashboardTrackingEventSnapshot = { id: string; statusCode: string; statusLabel: string; occurredAt: Date | string; description: string | null; location: string | null; isMock: boolean };
export type DashboardTrackingSnapshotMap = Map<string, DashboardTrackingSnapshot>;

type TrackingEventRow = { id: string; normalizedStatus: string; occurredAt: Date; description: string | null; location: string | null; metadata?: unknown };
type TrackingShipmentRow = { id: string; provider?: string | null; awb?: string | null; trackingUrl?: string | null; normalizedStatus: string; statusUpdatedAt?: Date | null; metadata?: unknown; events: TrackingEventRow[] };
type TrackingOrderRow = { shopifyOrderName: string; status: string; statusUpdatedAt?: Date | null; shipments: TrackingShipmentRow[] };
type TrackingDeps = { megaskaOrder: { findMany: (args: unknown) => Promise<TrackingOrderRow[]> } };
type TrackingPrismaClient = { megaskaOrder: { findMany: (args: unknown) => Promise<unknown> } };
const prismaWithTracking = prisma as unknown as TrackingPrismaClient;
const defaultDeps: TrackingDeps = { megaskaOrder: { findMany: async (args) => (await prismaWithTracking.megaskaOrder.findMany(args)) as TrackingOrderRow[] } };
let deps = defaultDeps;
export function setDashboardTrackingDependenciesForTest(overrides: Partial<TrackingDeps>) { deps = { ...defaultDeps, ...overrides } as TrackingDeps; }
export function resetDashboardTrackingDependenciesForTest() { deps = defaultDeps; }

const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s || null; };
const code = (v: unknown, fallback = "UNKNOWN") => (clean(v) || fallback).toUpperCase();
const label = (v: unknown) => code(v).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const isMock = (metadata: unknown) => Boolean((metadata as { mock?: unknown } | null)?.mock);
const iso = (v: Date | string | null | undefined) => v ? new Date(v).toISOString() : null;
const validDate = (v: Date | string | null | undefined) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const meaningful = (s: DashboardTrackingSnapshot | null) => Boolean(s?.shipments.length || s?.available);
const hasAwbOrUrl = (s: DashboardTrackingSnapshot | null) => Boolean(s?.shipments.some((x) => clean(x.awb) || clean(x.trackingUrl)));
function noTracking(): DashboardTrackingSnapshot { return { available: false, source: "NONE", summary: { statusCode: "TRACKING_PENDING", statusLabel: "Tracking pending", lastUpdatedAt: null, message: "Tracking details will appear once your order is shipped." }, shipments: [] }; }

function mapOrder(row: TrackingOrderRow): DashboardTrackingSnapshot {
  const shipments = row.shipments.map((shipment): DashboardTrackingShipmentSnapshot => ({
    id: shipment.id,
    direction: "FORWARD",
    carrier: clean(shipment.provider),
    awb: clean(shipment.awb),
    trackingUrl: clean(shipment.trackingUrl),
    statusCode: code(shipment.normalizedStatus),
    statusLabel: label(shipment.normalizedStatus),
    lastUpdatedAt: shipment.statusUpdatedAt ?? null,
    isMock: isMock(shipment.metadata),
    timeline: shipment.events.map((event) => ({ id: event.id, statusCode: code(event.normalizedStatus), statusLabel: label(event.normalizedStatus), occurredAt: event.occurredAt, description: clean(event.description), location: clean(event.location), isMock: isMock(event.metadata) })),
  }));
  const latest = shipments.find((s) => s.lastUpdatedAt)?.lastUpdatedAt ?? row.statusUpdatedAt ?? null;
  return { available: shipments.length > 0, source: "LOOPDESK_SHIPMENT", summary: { statusCode: code(row.status, "ORDER_CONFIRMED"), statusLabel: label(row.status || "ORDER_CONFIRMED"), lastUpdatedAt: latest, message: shipments.length ? null : "Tracking details will appear once your order is shipped." }, shipments };
}

export async function loadDashboardTrackingSnapshots(input: { context: CustomerDashboardContext; orders: DashboardCommerceOrder[] }): Promise<DashboardTrackingSnapshotMap> {
  const orderNumbers = Array.from(new Set(input.orders.map((o) => normalizeOrderNumber(o.orderNumber)).filter(Boolean)));
  const out: DashboardTrackingSnapshotMap = new Map();
  if (!orderNumbers.length) return out;
  const rows = await deps.megaskaOrder.findMany({ where: { shopId: input.context.shopId, customerProfileId: input.context.customerProfileId, shopifyOrderName: { in: orderNumbers } }, include: { shipments: { include: { events: { orderBy: { occurredAt: "desc" }, take: 8 } }, orderBy: { updatedAt: "desc" } } } });
  for (const row of rows) out.set(normalizeOrderNumber(row.shopifyOrderName), mapOrder(row));
  return out;
}

export function buildShopifyFallbackTracking(order: DashboardCommerceOrder): DashboardTrackingSnapshot | null {
  const shipments = (order.fulfillments || []).flatMap((fulfillment) => (fulfillment.trackingInfo || []).filter((entry) => clean(entry.number) || clean(entry.url) || clean(entry.company)).map((entry, index): DashboardTrackingShipmentSnapshot => {
    const status = code(fulfillment.status || order.fulfillmentStatus, "UNKNOWN");
    const statusLabel = label(status);
    const timeline: DashboardTrackingEventSnapshot[] = [];
    const id = `${fulfillment.id || "shopify-fulfillment"}-${index}`;
    if (fulfillment.createdAt) timeline.push({ id: `${id}-created`, statusCode: status, statusLabel, occurredAt: fulfillment.createdAt, description: "Fulfillment created in Shopify", location: null, isMock: false });
    if (fulfillment.deliveredAt) timeline.push({ id: `${id}-delivered`, statusCode: "DELIVERED", statusLabel: "Delivered", occurredAt: fulfillment.deliveredAt, description: "Shipment delivered", location: null, isMock: false });
    return { id, direction: "FORWARD", carrier: clean(entry.company), awb: clean(entry.number), trackingUrl: clean(entry.url), statusCode: status, statusLabel, lastUpdatedAt: fulfillment.deliveredAt || fulfillment.createdAt || null, isMock: false, timeline };
  }));
  if (!shipments.length) return null;
  return { available: true, source: "SHOPIFY_FULFILLMENT", summary: { statusCode: shipments[0].statusCode, statusLabel: shipments[0].statusLabel, lastUpdatedAt: shipments[0].lastUpdatedAt, message: "Tracking details are provided by Shopify fulfillment data." }, shipments };
}

export function selectDashboardTracking(input: { internalTracking: DashboardTrackingSnapshot | null; shopifyFallback: DashboardTrackingSnapshot | null }): DashboardTrackingSnapshot { if (hasAwbOrUrl(input.internalTracking)) return input.internalTracking!; if (input.shopifyFallback) return input.shopifyFallback; if (meaningful(input.internalTracking)) return input.internalTracking!; return noTracking(); }
export function buildDashboardTrackingDto(snapshot: DashboardTrackingSnapshot): DashboardTrackingDto { return { available: snapshot.available, source: snapshot.source, summary: { statusCode: code(snapshot.summary.statusCode), statusLabel: snapshot.summary.statusLabel || label(snapshot.summary.statusCode), lastUpdatedAt: iso(snapshot.summary.lastUpdatedAt), message: snapshot.summary.message }, shipments: snapshot.shipments.map((s) => ({ id: s.id, direction: s.direction as DashboardShipmentDirection, carrier: s.carrier, awb: s.awb, trackingUrl: s.trackingUrl, statusCode: code(s.statusCode), statusLabel: s.statusLabel || label(s.statusCode), lastUpdatedAt: iso(s.lastUpdatedAt), timeline: s.timeline.map((e) => ({ id: e.id, statusCode: code(e.statusCode), statusLabel: e.statusLabel || label(e.statusCode), occurredAt: new Date(e.occurredAt).toISOString(), description: e.description, location: e.location })) })) }; }
export function findTrustedDeliveredAt(input: { shopifyDeliveredAt: Date | string | null; tracking: DashboardTrackingSnapshot | null }): Date | string | null { const shopify = validDate(input.shopifyDeliveredAt); if (shopify) return input.shopifyDeliveredAt; let latest: Date | null = null; for (const shipment of input.tracking?.shipments || []) { const candidates = [shipment.statusCode === "DELIVERED" ? shipment.lastUpdatedAt : null, ...shipment.timeline.filter((e) => e.statusCode === "DELIVERED").map((e) => e.occurredAt)]; for (const c of candidates) { const d = validDate(c); if (d && (!latest || d > latest)) latest = d; } } return latest; }
