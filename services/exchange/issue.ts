import { EXCHANGE_ALLOWED_DAYS_WINDOW } from "./constants.ts";

const ISSUE_ACTIVE_STATUSES = ["OPEN", "AWAITING_PAYMENT", "PICKUP_PENDING", "PAYMENT_RECEIVED", "APPROVED", "RETURN_RECEIVED"] as const;

export const ISSUE_ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["AWAITING_PAYMENT", "PICKUP_PENDING", "PAYMENT_RECEIVED", "APPROVED", "REJECTED", "CLOSED"],
  AWAITING_PAYMENT: ["PICKUP_PENDING", "PAYMENT_RECEIVED", "APPROVED", "REJECTED", "CLOSED"],
  PICKUP_PENDING: ["AWAITING_PAYMENT", "PAYMENT_RECEIVED", "APPROVED", "REJECTED", "CLOSED"],
  PAYMENT_RECEIVED: ["APPROVED", "REJECTED", "CLOSED"],
  APPROVED: ["RETURN_RECEIVED"],
  RETURN_RECEIVED: ["CLOSED"],
};

export const ISSUE_STATUS_DESCRIPTIONS: Record<string, string> = {
  OPEN: "Issue request received",
  AWAITING_PAYMENT: "Under review",
  PICKUP_PENDING: "Need more information",
  PAYMENT_RECEIVED: "Approved for exchange",
  APPROVED: "Issue approved; awaiting returned goods",
  RETURN_RECEIVED: "Returned goods received at warehouse",
  REJECTED: "Issue request rejected",
  CLOSED: "Issue request closed",
};

function normalize(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function isDeliveredStatus(status: string) {
  return status.includes("delivered");
}

export function getIssueRefundMode(paymentGatewayName: string | null | undefined) {
  const normalized = normalize(paymentGatewayName);
  if (!normalized) return "UNSPECIFIED";
  return normalized.includes("cod") || normalized.includes("cash")
    ? "STORE_CREDIT_WALLET"
    : "ORIGINAL_PAYMENT_METHOD";
}

export function isIssueStatusBlocking(status: string | null | undefined) {
  return ISSUE_ACTIVE_STATUSES.includes(String(status || "").trim().toUpperCase() as (typeof ISSUE_ACTIVE_STATUSES)[number]);
}

export function evaluateIssueEligibility(input: {
  fulfillmentStatus?: string | null;
  deliveredAt?: string | null;
  fulfilledAt?: string | null;
  declaredUnused: boolean;
  declaredUnwashed: boolean;
  declaredTagsIntact: boolean;
  /** Days after delivery an issue can be reported. Defaults to EXCHANGE_ALLOWED_DAYS_WINDOW. */
  windowDays?: number;
}) {
  if (!input.declaredUnused || !input.declaredUnwashed || !input.declaredTagsIntact) {
    return { eligible: false, reason: "Issue requests require unused, unwashed items with tags intact." };
  }

  const fulfillmentStatus = normalize(input.fulfillmentStatus);
  const deliveredAtRaw = String(input.deliveredAt || "").trim();
  const deliveredAt = deliveredAtRaw ? new Date(deliveredAtRaw) : null;
  const hasValidDeliveredAt = Boolean(deliveredAt && !Number.isNaN(deliveredAt.getTime()));

  if (fulfillmentStatus && !isDeliveredStatus(fulfillmentStatus)) {
    return { eligible: false, reason: "Issue can be reported only after the order is delivered." };
  }

  if (!hasValidDeliveredAt) {
    return { eligible: false, reason: "We could not verify the delivery date for this order yet." };
  }

  if (hasValidDeliveredAt && deliveredAt) {
    const windowDays = Number.isFinite(input.windowDays) ? Number(input.windowDays) : EXCHANGE_ALLOWED_DAYS_WINDOW;
    const elapsedMs = Date.now() - deliveredAt.getTime();
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
    if (elapsedDays > windowDays) {
      return { eligible: false, reason: `Issue reporting is allowed within ${windowDays} days of delivery.` };
    }
  }

  return { eligible: true, reason: "Eligible for issue review" };
}
