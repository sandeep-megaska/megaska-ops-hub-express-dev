import {
  EXCHANGE_ALLOWED_DAYS_WINDOW,
  REVERSE_PICKUP_ALLOWED_DAYS_WINDOW,
  REVERSE_PICKUP_PAYMENT_EXPIRY_DAYS,
} from "./constants.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export const EXCHANGE_REQUEST_WINDOW_LOCK_REASON =
  "Exchange requests are allowed within 2 days of delivery.";
export const ISSUE_REQUEST_WINDOW_LOCK_REASON =
  "Issue reporting is allowed within 2 days of delivery.";
export const REVERSE_PICKUP_WINDOW_LOCK_REASON =
  "Reverse pickup is available only within 7 days of delivery.";

export function parseTrustedDeliveryDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function getRequestWindowExpiresAt(deliveredAt: string | Date | null | undefined) {
  const deliveryDate = parseTrustedDeliveryDate(deliveredAt);
  return deliveryDate ? addDays(deliveryDate, EXCHANGE_ALLOWED_DAYS_WINDOW) : null;
}

export function getReversePickupWindowExpiresAt(deliveredAt: string | Date | null | undefined) {
  const deliveryDate = parseTrustedDeliveryDate(deliveredAt);
  return deliveryDate ? addDays(deliveryDate, REVERSE_PICKUP_ALLOWED_DAYS_WINDOW) : null;
}

export function isWithinRequestWindow(deliveredAt: string | Date | null | undefined, now = new Date()) {
  const expiresAt = getRequestWindowExpiresAt(deliveredAt);
  return Boolean(expiresAt && now.getTime() <= expiresAt.getTime());
}

export function isWithinReversePickupWindow(deliveredAt: string | Date | null | undefined, now = new Date()) {
  const expiresAt = getReversePickupWindowExpiresAt(deliveredAt);
  return Boolean(expiresAt && now.getTime() <= expiresAt.getTime());
}

export function getReversePickupPaymentExpiresAt(approvedAt = new Date()) {
  return addDays(approvedAt, REVERSE_PICKUP_PAYMENT_EXPIRY_DAYS);
}
