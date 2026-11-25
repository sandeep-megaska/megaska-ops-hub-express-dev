// Rules for reverse pickups the team arranges by hand (pure: no database, no I/O).
//
// Two cases the automatic flow could not handle:
// - an exchange whose reverse-pickup fee was paid outside loopd2c's payment link
//   (the link expired and the team sent a new one from Razorpay), or waived;
// - a pickup for an order with no exchange (wrong or damaged item, a delivery
//   that arrived after the customer left, anything else): it is recorded as an
//   issue request created by the team, so tracking and the inspection / refund
//   steps have a home.

import { canTransitionExchangeStatus } from "./lifecycle.ts";
import { ISSUE_ALLOWED_STATUS_TRANSITIONS } from "./issue.ts";

export type PickupRequestType = "EXCHANGE" | "ISSUE";

/** The request status once its reverse pickup is booked with Delhivery. */
export function statusAfterPickupBooked(requestType: PickupRequestType, status: string): string {
  if (requestType === "EXCHANGE") {
    if (canTransitionExchangeStatus(status, "PICKUP_SCHEDULED")) return "PICKUP_SCHEDULED";
    if (canTransitionExchangeStatus(status, "PICKUP_PENDING")) return "PICKUP_PENDING";
    return status;
  }
  // Issues: "Approved; awaiting returned goods".
  if (status === "APPROVED") return status;
  return (ISSUE_ALLOWED_STATUS_TRANSITIONS[status] || []).includes("APPROVED") ? "APPROVED" : status;
}

/** Issue status when its reverse pickup reaches the warehouse. */
export function issueStatusAfterReverseShipment(status: string, shipmentStatus: string): string {
  return shipmentStatus === "DELIVERED" && status === "APPROVED" ? "RETURN_RECEIVED" : status;
}

/** Order numbers are stored as digits ("522404"); accept "#522404" and spaces too. */
export function normalizeOrderNumber(value: unknown): string {
  return String(value ?? "").trim().replace(/^#/, "").trim();
}

/**
 * Shopify search for an order by its number. Megaska's order names have no "#" ("522574"),
 * the default Shopify format does ("#1001"), so ask for both and pick the exact one.
 */
export function shopifyOrderNameQuery(orderNumber: string) {
  const digits = normalizeOrderNumber(orderNumber);
  return `name:${digits} OR name:#${digits}`;
}

export function pickShopifyOrderByName(nodes: Array<{ id?: string | null; name?: string | null }> | null | undefined, orderNumber: string) {
  const wanted = normalizeOrderNumber(orderNumber);
  return (nodes ?? []).find((node) => node?.id && normalizeOrderNumber(node.name) === wanted) ?? null;
}

export const RAZORPAY_PAYMENT_ID = /^pay_[A-Za-z0-9]{8,40}$/;

export type RazorpayPaymentFacts = { id?: unknown; status?: unknown; amount?: unknown; currency?: unknown; created_at?: unknown };

/**
 * Whether a Razorpay payment can settle a fee of `feePaise`: captured, in INR,
 * for at least the fee. Returns a message for the team when it can't.
 */
export function checkFeePayment(payment: RazorpayPaymentFacts | null, feePaise: number): { ok: true; amountPaise: number; paidAt: Date | null } | { ok: false; error: string } {
  if (!payment || typeof payment.id !== "string") return { ok: false, error: "Razorpay has no payment with this ID on your account." };
  const status = String(payment.status || "");
  if (status !== "captured") {
    return { ok: false, error: status === "authorized" ? "This payment is authorised but not captured yet. Capture it in Razorpay first." : `This payment is ${status || "not completed"}, not captured.` };
  }
  if (String(payment.currency || "").toUpperCase() !== "INR") return { ok: false, error: "This payment is not in INR." };
  const amountPaise = Number(payment.amount);
  if (!Number.isFinite(amountPaise) || amountPaise < feePaise) {
    return { ok: false, error: `This payment is ₹${(amountPaise / 100).toFixed(2)}, less than the ₹${(feePaise / 100).toFixed(2)} pickup fee.` };
  }
  const createdAt = Number(payment.created_at);
  return { ok: true, amountPaise, paidAt: Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt * 1000) : null };
}

export type PickupAddress = { name: string; phone: string; address1: string; address2: string; city: string; state: string; pin: string; country: string; email: string };

const ADDRESS_FIELDS: Array<keyof PickupAddress> = ["name", "phone", "address1", "address2", "city", "state", "pin", "country", "email"];

/** The order's address with the team's edits on top (blank edits keep the order's value). */
export function mergePickupAddress<T extends PickupAddress>(base: T | null, override: Partial<PickupAddress> | null | undefined): (T & { edited: boolean }) | null {
  if (!base && !override) return null;
  const merged = { ...(base ?? ({ name: "", phone: "", address1: "", address2: "", city: "", state: "", pin: "", country: "India", email: "", source: "profile" } as unknown as T)) } as T & { edited: boolean };
  let edited = false;
  for (const field of ADDRESS_FIELDS) {
    const value = typeof override?.[field] === "string" ? override[field]!.trim() : "";
    if (value && value !== String(merged[field] ?? "")) {
      (merged as Record<string, unknown>)[field] = value;
      edited = true;
    }
  }
  merged.edited = edited;
  return merged;
}

export const MANUAL_PICKUP_REASONS = {
  WRONG_ITEM: "Wrong item delivered",
  DAMAGED_ITEM: "Damaged or defective item",
  LATE_DELIVERY: "Delivered late; customer unavailable",
  OTHER: "Other",
} as const;

export type ManualPickupReason = keyof typeof MANUAL_PICKUP_REASONS;

export function isManualPickupReason(value: unknown): value is ManualPickupReason {
  return typeof value === "string" && value in MANUAL_PICKUP_REASONS;
}
