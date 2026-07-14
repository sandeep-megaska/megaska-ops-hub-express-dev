export type ExchangeReasonCode = "SIZE_TOO_SMALL" | "SIZE_TOO_LARGE" | "WRONG_VARIANT" | "FIT_NOT_SUITABLE" | "DAMAGED_OR_DEFECTIVE" | "OTHER";
export const EXCHANGE_REASON_LABELS: Record<ExchangeReasonCode, string> = {
  SIZE_TOO_SMALL: "Size too small",
  SIZE_TOO_LARGE: "Size too large",
  WRONG_VARIANT: "Wrong variant received",
  FIT_NOT_SUITABLE: "Fit not suitable",
  DAMAGED_OR_DEFECTIVE: "Damaged or defective",
  OTHER: "Other",
};
export const EXCHANGE_REASON_OPTIONS = Object.entries(EXCHANGE_REASON_LABELS).map(([value, label]) => ({ value, label }));
export const EXCHANGE_NOTE_MAX_LENGTH = 500;
export function isExchangeReasonCode(value: string): value is ExchangeReasonCode { return Object.prototype.hasOwnProperty.call(EXCHANGE_REASON_LABELS, value); }
