import { EXCHANGE_STATUS_DESCRIPTIONS } from "../../../exchange/lifecycle.ts";
import type { CustomerDashboardActionResult, ExchangeActionPayload } from "../contract.ts";
import type { CustomerDashboardActionContext } from "../context.ts";
import type { CustomerOwnedOrderSnapshot } from "../ownership.ts";
import { createExchangeRequest, validateExchangeRequest } from "../exchange-domain.ts";

function statusLabel(status: string) { return status === "AWAITING_PAYMENT" ? "Payment required" : EXCHANGE_STATUS_DESCRIPTIONS[status] || "Exchange requested"; }
export async function executeExchangeAction(input: { context: CustomerDashboardActionContext; order: CustomerOwnedOrderSnapshot; payload: ExchangeActionPayload; idempotencyKey: string }): Promise<CustomerDashboardActionResult> {
  const validation = await validateExchangeRequest(input);
  const { created, payment } = await createExchangeRequest({ context: input.context, order: input.order, validation });
  const statusCode = String(created.status || "OPEN").toUpperCase();
  const needsPayment = Boolean(payment && validation.fee.required);
  return { ok: true, actionType: "EXCHANGE", requestId: created.id, statusCode, statusLabel: needsPayment ? "Payment required" : statusLabel(statusCode), customerMessage: needsPayment ? "Complete the reverse pickup fee payment to continue." : "Your exchange request has been submitted.", orderId: input.order.id, orderNumber: input.order.orderNumber, createdAt: (created.requestedAt ?? input.context.now).toISOString(), nextAction: needsPayment ? { type: "PAYMENT_REQUIRED", url: `/api/account/exchange-requests/${created.id}/payment-link` } : { type: "REFRESH_DASHBOARD", url: null } };
}
