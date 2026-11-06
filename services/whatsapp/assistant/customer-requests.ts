// The customer's own exchange, cancellation, issue and refund requests (LoopD2C's records,
// which Shopify doesn't have), so the WhatsApp assistant can answer "where is my exchange?"
// from facts instead of handing every status question to the team. Matched on the WhatsApp
// number (last 10 digits, as stored on the request or the customer's profile).

import { EXCHANGE_STATUS_DESCRIPTIONS } from "../../exchange/lifecycle.ts";

export type CustomerRequest = {
  kind: "exchange" | "cancellation" | "issue" | "refund";
  order: string;
  requestedOn: string;
  status: string;
  items: string;
  pickup: string | null;
  replacement: string | null;
  refund: string | null;
};

export const REQUESTS_WITHIN_DAYS = 120;
export const MAX_REQUESTS = 5;

const KIND: Record<string, CustomerRequest["kind"]> = { EXCHANGE: "exchange", CANCELLATION: "cancellation", ISSUE: "issue", REFUND: "refund" };

// Customer words for a request's status. Exchanges have their own steps; cancellations, issue
// reports and refund requests use the same status values more simply.
export function requestStatusText(type: string, status: string) {
  if (type === "EXCHANGE") return EXCHANGE_STATUS_DESCRIPTIONS[status] ?? status.toLowerCase().replace(/_/g, " ");
  const noun = type === "CANCELLATION" ? "Cancellation" : type === "ISSUE" ? "Issue report" : "Refund request";
  if (status === "OPEN") return `${noun} received, being reviewed by the team`;
  if (status === "REJECTED") return `${noun} not accepted`;
  if (status === "CLOSED") return type === "CANCELLATION" ? "Order cancelled" : `${noun} resolved and closed`;
  if (["APPROVED", "PAYMENT_RECEIVED"].includes(status)) return `${noun} approved`;
  return `${noun}: ${status.toLowerCase().replace(/_/g, " ")}`;
}

const REFUND_TEXT: Record<string, string> = {
  PENDING: "refund being processed",
  MANUAL_PENDING: "refund being processed by the team",
  DETAILS_PENDING: "refund waiting for the customer's bank or UPI details",
  DETAILS_SUBMITTED: "refund details received, being processed",
  REVIEW_PENDING: "refund under review",
  APPROVED: "refund approved, payment to be sent",
  PAYOUT_PENDING: "refund payment being sent",
  PAID: "refunded",
  FAILED: "refund payment failed, the team will retry",
  REJECTED: "refund not approved",
  CANCELLED: "refund cancelled",
};

const rupees = (minor: number, currency: string) => {
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100); } catch { return `${currency} ${(minor / 100).toFixed(2)}`; }
};

export function refundText(refund: { status: string; amount: number; currency: string; method?: string | null }) {
  if (refund.status === "NOT_REQUIRED") return refund.method === "COD" || refund.method === "NO_REFUND" ? "no refund needed (cash on delivery)" : "no refund needed";
  const words = REFUND_TEXT[refund.status] ?? refund.status.toLowerCase().replace(/_/g, " ");
  // 1 is a placeholder for "no amount" in older rows.
  return refund.amount > 1 ? `${rupees(refund.amount, refund.currency)} ${words}` : words;
}

type Shipment = { direction: string; awb: string | null; trackingUrl: string | null; status: string | null };
export type RequestRow = {
  requestType: string;
  status: string;
  orderNumber: string;
  requestedAt: Date;
  items: Array<{ productTitle: string; currentSize: string | null; requestedSize: string | null; quantity: number }>;
  shipments: Shipment[];
  refundRequests: Array<{ status: string; amount: number; currency: string; method: string | null }>;
};

function shipmentText(shipment: Shipment | undefined) {
  if (!shipment || (!shipment.awb && !shipment.trackingUrl)) return null;
  return [shipment.status ? shipment.status.toLowerCase().replace(/_/g, " ") : null, shipment.awb ? `AWB ${shipment.awb}` : null, shipment.trackingUrl].filter(Boolean).join(" | ");
}

export function requestFromRow(row: RequestRow): CustomerRequest {
  const items = row.items.map((item) => `${item.quantity > 1 ? `${item.quantity} × ` : ""}${item.productTitle}${row.requestType === "EXCHANGE" && item.currentSize && item.requestedSize ? ` (size ${item.currentSize} → ${item.requestedSize})` : ""}`).join(", ");
  const refund = row.refundRequests[0];
  return {
    kind: KIND[row.requestType] ?? "issue",
    order: row.orderNumber.startsWith("#") ? row.orderNumber : `#${row.orderNumber}`,
    requestedOn: row.requestedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }),
    status: requestStatusText(row.requestType, row.status),
    items: items.length > 200 ? `${items.slice(0, 197)}…` : items,
    pickup: shipmentText(row.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP")),
    replacement: shipmentText(row.shipments.find((shipment) => shipment.direction === "FORWARD_REPLACEMENT")),
    refund: refund ? refundText(refund) : null,
  };
}

// For the prompt: one line per request.
export function requestLine(request: CustomerRequest) {
  return `- ${request.kind} for order ${request.order} (requested ${request.requestedOn}) | status: ${request.status}${request.items ? ` | items: ${request.items}` : ""}${request.pickup ? ` | pickup: ${request.pickup}` : ""}${request.replacement ? ` | replacement delivery: ${request.replacement}` : ""}${request.refund ? ` | refund: ${request.refund}` : ""}`;
}

type RequestsDb = { orderActionRequest: { findMany(args: unknown): Promise<RequestRow[]> } };

export async function loadCustomerRequests(shopId: string, contactPhone: string, now = new Date(), db?: RequestsDb): Promise<CustomerRequest[]> {
  const last10 = contactPhone.replace(/\D/g, "").slice(-10);
  if (last10.length < 10) return [];
  const client = db ?? ((await import("../../db/prisma.ts")).prisma as unknown as RequestsDb);
  const rows = await client.orderActionRequest.findMany({
    where: {
      shopId,
      requestedAt: { gte: new Date(now.getTime() - REQUESTS_WITHIN_DAYS * 86_400_000) },
      OR: [{ customerPhoneSnapshot: { endsWith: last10 } }, { customerProfile: { phoneE164: { endsWith: last10 } } }],
    },
    orderBy: { requestedAt: "desc" },
    take: MAX_REQUESTS,
    select: {
      requestType: true, status: true, orderNumber: true, requestedAt: true,
      items: { select: { productTitle: true, currentSize: true, requestedSize: true, quantity: true } },
      shipments: { select: { direction: true, awb: true, trackingUrl: true, status: true } },
      refundRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, amount: true, currency: true, method: true } },
    },
  });
  return rows.map(requestFromRow);
}
