import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../../../_lib/cors";
import { buildDashboardOrderActions } from "../../../../../../../../services/customer-dashboard/actions.ts";
import { loadDashboardModules } from "../../../../../../../../services/customer-dashboard/modules.ts";
import { loadDashboardOrderRequests } from "../../../../../../../../services/customer-dashboard/requests.ts";
import { CANCELLATION_REASON_OPTIONS, CANCELLATION_REASON_TEXT_MAX_LENGTH } from "../../../../../../../../services/customer-dashboard/actions/reasons.ts";
import { EXCHANGE_NOTE_MAX_LENGTH, EXCHANGE_REASON_OPTIONS } from "../../../../../../../../services/customer-dashboard/actions/exchange-reasons.ts";
import { currentExchangeFee, loadExchangeOrderLines, replacementOptionsForLine } from "../../../../../../../../services/customer-dashboard/actions/exchange-domain.ts";
import { issueFormOptions, validateIssueRequest } from "../../../../../../../../services/customer-dashboard/actions/issue-domain.ts";
import { ISSUE_DESCRIPTION_MAX_LENGTH, ISSUE_DESCRIPTION_MIN_LENGTH } from "../../../../../../../../services/customer-dashboard/actions/issue-reasons.ts";
import { auditCustomerDashboardAction, getCustomerDashboardActionDefinition, loadOwnedOrderForAction, normalizeActionError, resolveCustomerDashboardActionContext, toCustomerDashboardActionErrorDto, type CustomerDashboardActionFormConfig, type CustomerDashboardActionType } from "../../../../../../../../services/customer-dashboard/actions/index.ts";

export const runtime = "nodejs";
function secure(res: NextResponse) { res.headers.set("Cache-Control", "private, no-store"); res.headers.set("Vary", "Origin, Authorization, Access-Control-Request-Headers"); res.headers.set("X-Content-Type-Options", "nosniff"); return res; }
export async function OPTIONS(req: NextRequest) { return secure(withCors(req, handleOptions(req))); }

const cancellationFields = [
  { key: "reasonCode", name: "reasonCode", type: "select", label: "Reason for cancellation", required: true, options: CANCELLATION_REASON_OPTIONS },
  { key: "reasonText", name: "reasonText", type: "textarea", label: "Additional details", required: false, maxLength: CANCELLATION_REASON_TEXT_MAX_LENGTH },
] as const;

export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string; actionType: string }> }) {
  try {
    const params = await ctx.params;
    const actionType = String(params.actionType || "").toUpperCase() as CustomerDashboardActionType;
    const def = getCustomerDashboardActionDefinition(actionType);
    const context = await resolveCustomerDashboardActionContext(req);
    const [modules, order] = await Promise.all([loadDashboardModules(context), loadOwnedOrderForAction({ context, orderId: params.orderId })]);
    const reqs = await loadDashboardOrderRequests({ context, orderNumbers: [order.orderNumber] });
    const snap = reqs.byOrderNumber.get(order.orderNumber.replace(/^#/, "").toUpperCase()) || reqs.byOrderNumber.get(order.orderNumber) || { cancellation: null, exchange: null, issue: null, activeConflict: null };
    const policies = buildDashboardOrderActions({ now: context.now, fulfillmentStatus: order.fulfillmentStatus, fulfilledAt: order.fulfilledAt, deliveredAt: order.deliveredAt, trackingDeliveredAt: null, requests: snap, modules });
    const action = actionType === "CANCELLATION" ? policies.cancellation : actionType === "EXCHANGE" ? policies.exchange : policies.issue;
    const available = Boolean(modules[def.moduleCapability] && action.available && action.state === "AVAILABLE");
    let config: CustomerDashboardActionFormConfig = {
      actionType,
      available,
      title: actionType === "CANCELLATION" ? "Cancel order" : actionType === "EXCHANGE" ? "Exchange items" : action.label,
      description: actionType === "CANCELLATION" ? "Submit a cancellation request before the order is shipped." : actionType === "EXCHANGE" ? "Choose the items and replacement sizes or variants." : action.description ?? null,
      fields: available && actionType === "CANCELLATION" ? JSON.parse(JSON.stringify(cancellationFields)) : [],
      submitLabel: actionType === "CANCELLATION" ? "Submit cancellation request" : actionType === "EXCHANGE" ? "Continue exchange" : "Submit request",
      deadlineAt: action.deadlineAt ?? null,
      lockReason: modules[def.moduleCapability] ? action.lockReason ?? null : "This action is disabled for this store.",
    };
    if (actionType === "EXCHANGE") {
      const lines = available ? await loadExchangeOrderLines({ context, order }) : [];
      config = { ...config, fee: currentExchangeFee(), fields: available ? [{ key: "reasonCode", name: "reasonCode", type: "select", label: "Reason for exchange", required: true, options: EXCHANGE_REASON_OPTIONS }, { key: "note", name: "note", type: "textarea", label: "Additional details", required: false, maxLength: EXCHANGE_NOTE_MAX_LENGTH }] : [], items: lines.map((line) => ({ lineItemId: line.id, title: line.title, variantTitle: line.variantTitle, imageUrl: line.imageUrl, orderedQuantity: line.quantity, maxExchangeQuantity: line.quantity, eligible: true, lockReason: null, replacementOptions: replacementOptionsForLine(line).filter((v) => v.available).map((v) => ({ variantId: v.variantId, title: v.title, available: v.available })) })) };
    }
    if (actionType === "ISSUE") {
      const validation = available ? await validateIssueRequest({ context, order }) : null;
      config = { ...config, title: "Report an issue", description: "Tell us what went wrong with delivered items.", submitLabel: "Submit issue report", issueTypes: available ? issueFormOptions() : [], descriptionRules: { required: true, minimumLength: ISSUE_DESCRIPTION_MIN_LENGTH, maximumLength: ISSUE_DESCRIPTION_MAX_LENGTH }, attachments: { enabled: false, optional: true, maximumCount: 0, uploadSupported: false }, fields: available ? [{ key: "issueType", name: "issueType", type: "select", label: "Issue type", required: true }, { key: "description", name: "description", type: "textarea", label: "Description", required: true, maxLength: ISSUE_DESCRIPTION_MAX_LENGTH }] : [], items: (validation?.lines || []).map((line) => ({ lineItemId: line.id, title: line.title, variantTitle: line.variantTitle, sku: line.sku, imageUrl: line.imageUrl, purchasedQuantity: line.quantity, deliveredQuantity: line.quantity, maximumIssueQuantity: line.quantity, available: true, lockReason: null })) };
    }
    await auditCustomerDashboardAction({ event: actionType === "EXCHANGE" ? "customer_dashboard.exchange.form_viewed" : actionType === "ISSUE" ? "customer_dashboard.issue.form_viewed" : "customer_dashboard.cancellation.form_viewed", context, actionType, orderId: order.id, orderNumber: order.orderNumber, resultCode: available ? "AVAILABLE" : "LOCKED" });
    return secure(withCors(req, NextResponse.json(config, { status: 200 })));
  } catch (error) {
    const normalized = normalizeActionError(error);
    return secure(withCors(req, NextResponse.json(toCustomerDashboardActionErrorDto(normalized), { status: normalized.status })));
  }
}
