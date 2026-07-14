import type { CancellationActionPayload, CustomerDashboardActionRequest, CustomerDashboardActionType, CustomerDashboardValidatedPayload, ExchangeActionPayload, IssueActionPayload } from "./contract.ts";
import { CustomerDashboardActionError } from "./errors.ts";
import { CANCELLATION_REASON_TEXT_MAX_LENGTH, isCancellationReasonCode } from "./reasons.ts";
import { EXCHANGE_NOTE_MAX_LENGTH, isExchangeReasonCode } from "./exchange-reasons.ts";

const types = new Set(["CANCELLATION", "EXCHANGE", "ISSUE"]);
const html = /<[^>]+>/;
const control = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const max = { reasonCode: 60, reasonText: CANCELLATION_REASON_TEXT_MAX_LENGTH, description: 1000, note: EXCHANGE_NOTE_MAX_LENGTH, idempotencyKey: 128 };

function obj(v: unknown, path: string) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid({ [path]: "Must be an object." });
  return v as Record<string, unknown>;
}
function invalid(fieldErrors: Record<string, string>, message = "Please check the highlighted fields."): never {
  throw new CustomerDashboardActionError({ code: "INVALID_INPUT", message, status: 400, fieldErrors });
}
function clean(v: unknown, path: string, limit: number, required = true) {
  const s = String(v ?? "").trim();
  if (required && !s) invalid({ [path]: "Required." });
  if (s.length > limit) invalid({ [path]: `Must be ${limit} characters or fewer.` });
  if (html.test(s)) invalid({ [path]: "HTML is not allowed." });
  if (control.test(s)) invalid({ [path]: "Control characters are not allowed." });
  return s;
}

export function validateCustomerDashboardActionRequest(input: unknown): CustomerDashboardActionRequest {
  const r = obj(input, "body");
  const actionType = String(r.actionType || "") as CustomerDashboardActionType;
  if (!types.has(actionType)) throw new CustomerDashboardActionError({ code: "ACTION_NOT_AVAILABLE", message: "That action is not available.", status: 404 });
  const orderId = clean(r.orderId, "orderId", 160);
  if (!/^[A-Za-z0-9_:#\-/.]+$/.test(orderId)) invalid({ orderId: "Invalid order ID." });
  const idempotencyKey = clean(r.idempotencyKey, "idempotencyKey", max.idempotencyKey);
  return { actionType, orderId, idempotencyKey, payload: r.payload ?? {} };
}

export function validateCancellationPayload(payload: unknown): CancellationActionPayload {
  const p = obj(payload, "payload");
  const reasonCode = clean(p.reasonCode, "reasonCode", max.reasonCode).toUpperCase();
  if (!isCancellationReasonCode(reasonCode)) invalid({ reasonCode: "Select a valid cancellation reason." });
  const reasonText = p.reasonText == null ? null : clean(p.reasonText, "reasonText", max.reasonText, false);
  if (reasonCode === "OTHER" && !reasonText) invalid({ reasonText: "Additional details are required for Other." });
  return { reasonCode, reasonText };
}

function validateLines(lines: unknown, path: string, exchange: boolean) {
  if (!Array.isArray(lines) || !lines.length) invalid({ [path]: "At least one line item is required." });
  const seen = new Set<string>();
  return lines.map((raw, i) => {
    const l = obj(raw, `${path}.${i}`);
    const lineItemId = clean(l.lineItemId, `${path}.${i}.lineItemId`, 120);
    if (seen.has(lineItemId)) invalid({ [`${path}.${i}.lineItemId`]: "Duplicate line item." });
    seen.add(lineItemId);
    const quantity = Number(l.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) invalid({ [`${path}.${i}.quantity`]: "Invalid quantity." });
    if (!exchange) return { lineItemId, quantity };
    const requestedVariantId = clean(l.requestedVariantId, `${path}.${i}.requestedVariantId`, 160);
    const reasonCode = clean(l.reasonCode, `${path}.${i}.reasonCode`, max.reasonCode).toUpperCase();
    if (!isExchangeReasonCode(reasonCode)) invalid({ [`${path}.${i}.reasonCode`]: "Select a valid exchange reason." });
    const note = l.note == null ? null : clean(l.note, `${path}.${i}.note`, max.note, false);
    if (reasonCode === "OTHER" && !note) invalid({ [`${path}.${i}.note`]: "Additional details are required for Other." });
    return { lineItemId, quantity, requestedVariantId, reasonCode, note };
  });
}
export function validateExchangePayload(payload: unknown): ExchangeActionPayload { const p = obj(payload, "payload"); return { lineItems: validateLines(p.lineItems, "lineItems", true) as ExchangeActionPayload["lineItems"] }; }
export function validateIssuePayload(payload: unknown): IssueActionPayload { const p = obj(payload, "payload"); const issueType = clean(p.issueType, "issueType", 40) as IssueActionPayload["issueType"]; if (!["DAMAGED", "WRONG_ITEM", "MISSING_ITEM", "QUALITY", "OTHER"].includes(issueType)) invalid({ issueType: "Invalid issue type." }); const attachments = p.attachments == null ? [] : Array.isArray(p.attachments) ? p.attachments.map((a, i) => { const token = clean(obj(a, `attachments.${i}`).token, `attachments.${i}.token`, 180); if (/^https?:|data:/i.test(token)) invalid({ [`attachments.${i}.token`]: "Use an upload token, not a URL." }); return { token }; }) : invalid({ attachments: "Invalid attachments." }); if (attachments.length > 5) invalid({ attachments: "At most 5 attachments are allowed." }); return { issueType, lineItems: validateLines(p.lineItems, "lineItems", false) as IssueActionPayload["lineItems"], description: clean(p.description, "description", max.description), attachments }; }
export function validatePayloadForAction(type: CustomerDashboardActionType, payload: unknown): CustomerDashboardValidatedPayload { return type === "CANCELLATION" ? validateCancellationPayload(payload) : type === "EXCHANGE" ? validateExchangePayload(payload) : validateIssuePayload(payload); }
