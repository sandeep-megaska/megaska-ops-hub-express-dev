import type { DashboardOrderRequestTimelineDto, DashboardOrderRequestTimelineEventDto, DashboardOrderRequestTimelineItemDto, DashboardOrderRequestTimelineRequestType } from "./contract.ts";
import type { DashboardCancellationRequestSnapshot, DashboardExchangeRequestSnapshot, DashboardIssueRequestSnapshot } from "./requests.ts";

type SourceRequest =
  | (DashboardCancellationRequestSnapshot & { requestType: "CANCELLATION" })
  | (DashboardExchangeRequestSnapshot & { requestType: "EXCHANGE" })
  | (DashboardIssueRequestSnapshot & { requestType: "ISSUE" });

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  PICKUP_PENDING: "Processing",
  PICKUP_SCHEDULED: "Processing",
  PICKUP_COMPLETED: "Processing",
  ITEM_RECEIVED: "Processing",
  REPLACEMENT_PROCESSING: "Processing",
  REPLACEMENT_SHIPPED: "Processing",
};
const TITLES: Record<DashboardOrderRequestTimelineRequestType, string> = { CANCELLATION: "Cancellation requested", EXCHANGE: "Exchange requested", ISSUE: "Issue reported" };
const TYPE_LABELS: Record<DashboardOrderRequestTimelineRequestType, string> = { CANCELLATION: "Cancellation", EXCHANGE: "Exchange", ISSUE: "Issue" };
const ORDER: Record<string, number> = { Submitted: 0, "Under Review": 1, Approved: 2, Rejected: 3, Processing: 4, Completed: 5, Closed: 6, Cancelled: 7 };
const iso = (d: Date | null | undefined) => d ? d.toISOString() : null;
export function normalizeCustomerRequestStatus(status: string | null | undefined): { currentStatus: string; statusLabel: string } {
  const currentStatus = String(status || "OPEN").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return { currentStatus, statusLabel: STATUS_LABELS[currentStatus] || humanize(currentStatus) };
}
function humanize(value: string) { return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function event(id: string, label: string, occurredAt: string): DashboardOrderRequestTimelineEventDto { return { id, label, occurredAt }; }
function buildEvents(request: SourceRequest): DashboardOrderRequestTimelineEventDto[] {
  const normalized = normalizeCustomerRequestStatus(request.status);
  const events: DashboardOrderRequestTimelineEventDto[] = [event(`${request.requestType.toLowerCase()}-${request.id}-submitted`, "Submitted", request.requestedAt.toISOString())];
  const updated = iso(request.updatedAt);
  if (updated && normalized.statusLabel !== "Submitted") events.push(event(`${request.requestType.toLowerCase()}-${request.id}-${normalized.currentStatus.toLowerCase()}`, normalized.statusLabel, updated));
  return events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime() || (ORDER[a.label] ?? 99) - (ORDER[b.label] ?? 99) || a.id.localeCompare(b.id));
}
function item(request: SourceRequest): DashboardOrderRequestTimelineItemDto {
  const normalized = normalizeCustomerRequestStatus(request.status);
  const createdAt = request.requestedAt.toISOString();
  const updatedAt = iso(request.updatedAt) || createdAt;
  return { id: `${request.requestType.toLowerCase()}-${request.id}`, requestType: request.requestType, requestId: request.id, createdAt, updatedAt, currentStatus: normalized.currentStatus, statusLabel: normalized.statusLabel, title: TITLES[request.requestType], subtitle: `${TYPE_LABELS[request.requestType]} request ${normalized.statusLabel.toLowerCase()}`, events: buildEvents(request) };
}
export function buildCustomerRequestTimeline(input: { cancellations?: DashboardCancellationRequestSnapshot[] | null; exchanges?: DashboardExchangeRequestSnapshot[] | null; issues?: DashboardIssueRequestSnapshot[] | null }): DashboardOrderRequestTimelineDto {
  const requests: SourceRequest[] = [
    ...(input.cancellations || []).map((r) => ({ ...r, requestType: "CANCELLATION" as const })),
    ...(input.exchanges || []).map((r) => ({ ...r, requestType: "EXCHANGE" as const })),
    ...(input.issues || []).map((r) => ({ ...r, requestType: "ISSUE" as const })),
  ];
  return requests.map(item).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || a.requestType.localeCompare(b.requestType) || a.requestId.localeCompare(b.requestId));
}
