import { hashIdempotencyKey } from "./idempotency.ts";
import type { CustomerDashboardActionContext } from "./context.ts";
import type { CustomerDashboardActionType } from "./contract.ts";

type EventName =
  | "customer_dashboard.action.attempted"
  | "customer_dashboard.action.rejected"
  | "customer_dashboard.action.created"
  | "customer_dashboard.action.idempotent_replay"
  | "customer_dashboard.action.failed"
  | "customer_dashboard.cancellation.form_viewed"
  | "customer_dashboard.cancellation.attempted"
  | "customer_dashboard.cancellation.created"
  | "customer_dashboard.cancellation.rejected"
  | "customer_dashboard.cancellation.idempotent_replay"
  | "customer_dashboard.cancellation.failed";
type Logger = Pick<Console, "info" | "warn" | "error">;
let logger: Logger = console;
export function setActionAuditLoggerForTest(l: Logger) { logger = l; }
export function resetActionAuditLoggerForTest() { logger = console; }
export async function auditCustomerDashboardAction(input: { event: EventName; context: CustomerDashboardActionContext; actionType: CustomerDashboardActionType; orderId?: string; orderNumber?: string; requestId?: string; resultCode?: string; reasonCode?: string; idempotencyKey?: string }) {
  const body = { shopId: input.context.shopId, customerProfileId: input.context.customerProfileId, orderId: input.orderId, orderNumber: input.orderNumber, actionType: input.actionType, requestId: input.requestId, reasonCode: input.reasonCode, resultCode: input.resultCode, idempotencyKeyHash: input.idempotencyKey ? hashIdempotencyKey(input.idempotencyKey) : undefined };
  (input.event.endsWith("failed") ? logger.error : input.event.endsWith("rejected") ? logger.warn : logger.info)(input.event, body);
}
