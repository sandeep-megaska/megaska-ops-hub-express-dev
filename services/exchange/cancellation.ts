export const CANCELLATION_ACTIVE_STATUSES = ["OPEN", "APPROVED"] as const;
export const CANCELLATION_BLOCKING_STATUSES = ["OPEN", "APPROVED", "CLOSED"] as const;

export const CANCELLATION_ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["APPROVED", "REJECTED", "CLOSED"],
  APPROVED: ["CLOSED"],
};

function normalize(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function hasAnyKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

function normalizeFulfillmentStatus(value: string | null | undefined) {
  const status = normalize(value).replace(/[\s-]+/g, "_");
  if (!status) return null;
  if (status === "unfulfilled") return "UNFULFILLED";
  if (status === "fulfilled") return "FULFILLED";
  if (status === "delivered") return "DELIVERED";
  if (status === "in_transit") return "IN_TRANSIT";
  if (status === "out_for_delivery") return "OUT_FOR_DELIVERY";
  if (status === "partial" || status === "partially_fulfilled") return "PARTIAL";
  if (status === "shipped") return "SHIPPED";
  return null;
}

function hasTimestamp(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const parsed = new Date(raw);
  return !Number.isNaN(parsed.getTime());
}

export function evaluateCancellationEligibility(input: {
  fulfillmentStatus?: string | null;
  financialStatus?: string | null;
  orderCancelled?: boolean;
  fulfilledAt?: string | null;
  deliveredAt?: string | null;
}) {
  const fulfillmentStatus = normalizeFulfillmentStatus(input.fulfillmentStatus);
  const financialStatus = normalize(input.financialStatus);
  const fulfilledAtExists = hasTimestamp(input.fulfilledAt);
  const deliveredAtExists = hasTimestamp(input.deliveredAt);

  if (input.orderCancelled || hasAnyKeyword(financialStatus, ["void", "cancel", "refunded"])) {
    return {
      eligible: false,
      reason: "Order is already cancelled.",
    };
  }

  if (fulfilledAtExists || deliveredAtExists) {
    return {
      eligible: false,
      reason: "Cancellation not possible — order already shipped.",
    };
  }

  if (["FULFILLED", "DELIVERED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "PARTIAL", "SHIPPED"].includes(String(fulfillmentStatus || ""))) {
    return {
      eligible: false,
      reason: "Cancellation not possible — order already shipped.",
    };
  }

  return {
    eligible: true,
    reason: "Eligible for cancellation",
  };
}

export function isCancellationStatusBlocking(status: string | null | undefined) {
  const normalized = String(status || "").trim().toUpperCase();
  return CANCELLATION_BLOCKING_STATUSES.includes(normalized as (typeof CANCELLATION_BLOCKING_STATUSES)[number]);
}
