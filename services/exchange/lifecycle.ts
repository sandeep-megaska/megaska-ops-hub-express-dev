export const TERMINAL_EXCHANGE_STATUSES = ["REJECTED", "CLOSED"] as const;

export const ACTIVE_EXCHANGE_STATUSES = [
  "OPEN",
  "AWAITING_PAYMENT",
  "PAYMENT_RECEIVED",
  "APPROVED",
  "PICKUP_PENDING",
  "PICKUP_SCHEDULED",
  "PICKUP_COMPLETED",
  "ITEM_RECEIVED",
  "REPLACEMENT_PROCESSING",
  "REPLACEMENT_SHIPPED",
] as const;

export const EXCHANGE_STATUS_DESCRIPTIONS: Record<string, string> = {
  OPEN: "Request received",
  AWAITING_PAYMENT: "Approved and awaiting reverse pickup fee payment",
  PAYMENT_RECEIVED: "Approved for exchange",
  APPROVED: "Approved for exchange",
  REJECTED: "Exchange request rejected",
  PICKUP_PENDING: "Reverse pickup pending",
  PICKUP_SCHEDULED: "Reverse pickup scheduled",
  PICKUP_COMPLETED: "Pickup completed",
  ITEM_RECEIVED: "Item received at warehouse",
  REPLACEMENT_PROCESSING: "Replacement being processed",
  REPLACEMENT_SHIPPED: "Replacement shipped",
  CLOSED: "Exchange completed",
};

export const allowedStatusTransitions: Record<string, string[]> = {
  OPEN: ["APPROVED", "REJECTED", "AWAITING_PAYMENT"],
  AWAITING_PAYMENT: ["APPROVED", "REJECTED", "PAYMENT_RECEIVED"],
  PAYMENT_RECEIVED: ["APPROVED", "REJECTED", "PICKUP_PENDING", "PICKUP_SCHEDULED"],
  APPROVED: ["PICKUP_PENDING", "PICKUP_SCHEDULED", "REJECTED"],
  PICKUP_PENDING: ["PICKUP_SCHEDULED", "PICKUP_COMPLETED"],
  PICKUP_SCHEDULED: ["PICKUP_COMPLETED"],
  PICKUP_COMPLETED: ["ITEM_RECEIVED"],
  ITEM_RECEIVED: ["REPLACEMENT_PROCESSING"],
  REPLACEMENT_PROCESSING: ["REPLACEMENT_SHIPPED"],
  REPLACEMENT_SHIPPED: ["CLOSED"],
};


export function canTransitionExchangeStatus(currentStatus: string, nextStatus: string) {
  if (currentStatus === nextStatus) return true;
  const allowed = allowedStatusTransitions[currentStatus] || [];
  return allowed.includes(nextStatus);
}
