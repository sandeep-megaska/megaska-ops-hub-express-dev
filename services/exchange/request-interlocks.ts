import { ACTIVE_EXCHANGE_STATUSES } from "./lifecycle.ts";
import { CANCELLATION_ACTIVE_STATUSES } from "./cancellation.ts";
import { isIssueStatusBlocking } from "./issue.ts";

export const ACTIVE_REQUEST_TYPES = [
  "CANCELLATION",
  "EXCHANGE",
  "ISSUE",
] as const;

export function normalizeOrderNumber(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed.startsWith("#") ? trimmed : trimmed ? `#${trimmed}` : "";
}

export function orderNumberVariants(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  const normalized = normalizeOrderNumber(trimmed);
  const withoutHash = normalized.replace(/^#/, "");
  return Array.from(
    new Set([trimmed, normalized, withoutHash].filter(Boolean)),
  );
}

export function isActiveRequestStatus(
  requestType: string | null | undefined,
  status: string | null | undefined,
) {
  const type = String(requestType || "")
    .trim()
    .toUpperCase();
  const normalizedStatus = String(status || "")
    .trim()
    .toUpperCase();

  if (type === "CANCELLATION") {
    return CANCELLATION_ACTIVE_STATUSES.includes(
      normalizedStatus as (typeof CANCELLATION_ACTIVE_STATUSES)[number],
    );
  }

  if (type === "EXCHANGE") {
    return ACTIVE_EXCHANGE_STATUSES.includes(
      normalizedStatus as (typeof ACTIVE_EXCHANGE_STATUSES)[number],
    );
  }

  if (type === "ISSUE") {
    return isIssueStatusBlocking(normalizedStatus);
  }

  return false;
}

export function findActiveRequest<
  T extends { requestType: string; status: string },
>(requests: T[]) {
  return (
    requests.find((request) =>
      isActiveRequestStatus(request.requestType, request.status),
    ) || null
  );
}

export function formatRequestLockReason(
  request: { requestType: string; status: string } | null,
) {
  if (!request) return null;
  const type = String(request.requestType || "request")
    .trim()
    .toLowerCase();
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  const status = String(request.status || "OPEN")
    .trim()
    .replace(/_/g, " ")
    .toLowerCase();
  return `${label} request is ${status}.`;
}
