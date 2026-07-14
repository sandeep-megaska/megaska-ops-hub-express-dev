export type CancellationReasonCode =
  | "ORDERED_BY_MISTAKE"
  | "WRONG_SIZE_OR_VARIANT"
  | "CHANGE_OF_MIND"
  | "DELIVERY_TOO_LATE"
  | "DUPLICATE_ORDER"
  | "PAYMENT_OR_PRICE_ISSUE"
  | "OTHER";

export const CANCELLATION_REASON_LABELS: Record<CancellationReasonCode, string> = {
  ORDERED_BY_MISTAKE: "Ordered by mistake",
  WRONG_SIZE_OR_VARIANT: "Wrong size or variant",
  CHANGE_OF_MIND: "Changed my mind",
  DELIVERY_TOO_LATE: "Delivery will be too late",
  DUPLICATE_ORDER: "Duplicate order",
  PAYMENT_OR_PRICE_ISSUE: "Payment or price issue",
  OTHER: "Other",
};

export const CANCELLATION_REASON_OPTIONS = Object.entries(CANCELLATION_REASON_LABELS).map(([value, label]) => ({ value, label }));
export const CANCELLATION_REASON_TEXT_MAX_LENGTH = 500;
export function isCancellationReasonCode(value: string): value is CancellationReasonCode {
  return Object.prototype.hasOwnProperty.call(CANCELLATION_REASON_LABELS, value);
}
