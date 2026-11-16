// How a Shopify order counts for GST, and India-time dates, for the B2C sales
// register (GSTR-1). Pure: no database, no I/O.

/**
 * - SALE: a supply; it is invoiced and reported.
 * - VOID: cancelled before anything was paid (Shopify "Voided", or a cancelled
 *   order still pending/authorised). No supply took place: it is not invoiced,
 *   and an invoice already made for it is cancelled.
 * - REFUNDED: paid, then fully refunded. It stays invoiced and gets a credit
 *   note dated on the refund, which nets it out.
 * - PARTIALLY_REFUNDED: paid, part refunded. It stays invoiced; the credit note
 *   for the refunded part is left to the team (which items is not known here).
 */
export type GstOrderClass = "SALE" | "VOID" | "REFUNDED" | "PARTIALLY_REFUNDED";

const UNPAID_STATUSES = new Set(["", "PENDING", "AUTHORIZED", "EXPIRED"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The order status fields kept on a GST order import snapshot (refreshed on every sync). */
export function orderStatusOf(snapshotRaw: unknown): {
  financialStatus: string;
  fulfillmentStatus: string;
  cancelledAt: string;
  paymentGateway: string;
} {
  const snapshot = record(snapshotRaw);
  return {
    financialStatus: text(snapshot.financialStatus).toUpperCase(),
    fulfillmentStatus: text(snapshot.fulfillmentStatus).toUpperCase(),
    cancelledAt: text(snapshot.cancelledAt),
    paymentGateway: text(snapshot.paymentGateway),
  };
}

export function classifyOrderForGst(snapshotRaw: unknown): GstOrderClass {
  const { financialStatus, cancelledAt } = orderStatusOf(snapshotRaw);
  if (financialStatus === "VOIDED") return "VOID";
  if (cancelledAt && UNPAID_STATUSES.has(financialStatus)) return "VOID";
  if (financialStatus === "REFUNDED") return "REFUNDED";
  if (financialStatus === "PARTIALLY_REFUNDED") return "PARTIALLY_REFUNDED";
  // No status recorded (imported before statuses were kept) counts as a sale, as before.
  return "SALE";
}

/** When the order was (last) refunded: the credit note's date. Null if unknown. */
export function refundDateOf(snapshotRaw: unknown): Date | null {
  const refunds = record(snapshotRaw).refunds;
  if (!Array.isArray(refunds)) return null;
  const times = refunds
    .map((refund) => new Date(text(record(refund).createdAt)).getTime())
    .filter((time) => Number.isFinite(time));
  return times.length ? new Date(Math.max(...times)) : null;
}

// India Standard Time is UTC+05:30 all year (no daylight saving).
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The India-time calendar date of an instant, as YYYY-MM-DD. */
export function istDateString(value: Date): string {
  return new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start (00:00:00.000 IST) of an India-time calendar date YYYY-MM-DD. */
export function istDayStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000+05:30`);
}

/** End (23:59:59.999 IST) of an India-time calendar date YYYY-MM-DD. */
export function istDayEnd(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+05:30`);
}

/** "Product", or "Service" for a SAC code (HSN chapter 99 is services). */
export function itemTypeForHsn(hsn: string): string {
  return text(hsn).startsWith("99") ? "Service" : "Product";
}
