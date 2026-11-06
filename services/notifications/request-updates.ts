// WhatsApp updates to the customer on cancellations, issue reports and refunds, from the shop's
// own number when "Cancellation, issue and refund updates" is ticked (requestUpdatesEnabled;
// its own switch, so exchange updates can run while these templates await Meta). Until now these steps only alerted the store's team. One message per step: a marker
// AuditEvent (like exchange milestones) stops repeats from every code path that reaches it.

import { exchangeTemplateName, REQUEST_TEMPLATE_NAMES } from "../whatsapp/exchange-templates.ts";

export type RequestUpdateKey = keyof typeof REQUEST_TEMPLATE_NAMES;

// Which step of which request type sends which template.
export function requestUpdateKey(requestType: string, status: string): RequestUpdateKey | null {
  const key = `${requestType}_${status}`;
  return key in REQUEST_TEMPLATE_NAMES && !key.startsWith("REFUND_") ? (key as RequestUpdateKey) : null;
}

const orderLabel = (orderNumber: string) => orderNumber.replace(/^#/, "");
const firstName = (name: string | null | undefined) => String(name ?? "").trim().split(/\s+/)[0] || "there";

export function requestUpdateVariables(input: { customerName: string | null; orderNumber: string }) {
  return [firstName(input.customerName), orderLabel(input.orderNumber)];
}

export function refundAmountText(minor: number, currency: string) {
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100); } catch { return `${currency} ${(minor / 100).toFixed(2)}`; }
}

type SendDeps = {
  marker(entityType: string, entityId: string, eventType: string): Promise<boolean>;
  mark(entityType: string, entityId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
  sender(shopId: string): Promise<{ languageCode: string } | null>;
  send(input: { sender: unknown; shopId: string; toPhone: string; templateName: string; languageCode: string; variables: string[] }): Promise<unknown>;
};

async function defaultDeps(): Promise<SendDeps> {
  const [{ prisma }, { resolveWhatsAppSender }, { sendTemplateMessage }] = await Promise.all([import("../db/prisma.ts"), import("../whatsapp/sender.ts"), import("../whatsapp/index.ts")]);
  return {
    marker: async (entityType, entityId, eventType) => Boolean(await prisma.auditEvent.findFirst({ where: { entityType, entityId, eventType }, select: { id: true } })),
    mark: async (entityType, entityId, eventType, payload) => { await prisma.auditEvent.create({ data: { actorType: "system", eventType, entityType, entityId, payload: payload as never } }); },
    sender: (shopId) => resolveWhatsAppSender(shopId, "requests"),
    send: (input) => sendTemplateMessage(input as never),
  };
}

export async function sendRequestUpdate(input: { entityType: string; entityId: string; shopId: string | null; key: RequestUpdateKey; toPhone: string | null; variables: string[] }, deps?: SendDeps) {
  if (!input.shopId || !input.toPhone) return { sent: false, reason: "no-shop-or-phone" };
  const d = deps ?? (await defaultDeps());
  const eventType = `request.update_notified.${input.key}`;
  if (await d.marker(input.entityType, input.entityId, eventType)) return { sent: false, reason: "already-notified" };
  // Only from the shop's own number with request updates switched on.
  const sender = await d.sender(input.shopId);
  if (!sender) return { sent: false, reason: "updates-off" };
  await d.send({ sender, shopId: input.shopId, toPhone: input.toPhone, templateName: exchangeTemplateName(input.key), languageCode: sender.languageCode, variables: input.variables });
  await d.mark(input.entityType, input.entityId, eventType, { shopId: input.shopId, key: input.key });
  return { sent: true };
}

// After a cancellation or issue report changes status (or an issue report is created).
// Never throws: safe to call from any route.
export async function notifyRequestUpdate(requestId: string) {
  try {
    const { prisma } = await import("../db/prisma.ts");
    const request = await prisma.orderActionRequest.findUnique({ where: { id: requestId }, select: { id: true, shopId: true, requestType: true, status: true, orderNumber: true, customerNameSnapshot: true, customerPhoneSnapshot: true, customerProfile: { select: { phoneE164: true } } } });
    if (!request) return { sent: false, reason: "not-found" };
    const key = requestUpdateKey(String(request.requestType), String(request.status));
    if (!key) return { sent: false, reason: "no-update-for-step" };
    const result = await sendRequestUpdate({ entityType: "OrderActionRequest", entityId: request.id, shopId: request.shopId, key, toPhone: request.customerPhoneSnapshot ?? request.customerProfile?.phoneE164 ?? null, variables: requestUpdateVariables({ customerName: request.customerNameSnapshot, orderNumber: request.orderNumber }) });
    console.info("[REQUEST UPDATE]", { requestId, key, ...result });
    return result;
  } catch (error) {
    console.error("[REQUEST UPDATE] failed", { requestId, error: error instanceof Error ? error.message : String(error) });
    return { sent: false, reason: "error" };
  }
}

// After a refund is paid (only refunds tied to a cancellation, issue or exchange, which name the order).
export async function notifyRefundPaid(refundRequestId: string) {
  try {
    const { prisma } = await import("../db/prisma.ts");
    const refund = await prisma.refundRequest.findUnique({ where: { id: refundRequestId }, select: { id: true, shopId: true, status: true, amount: true, currency: true, orderActionRequest: { select: { orderNumber: true, customerNameSnapshot: true, customerPhoneSnapshot: true, customerProfile: { select: { phoneE164: true } } } } } });
    const request = refund?.orderActionRequest;
    if (!refund || refund.status !== "PAID" || !request || !(refund.amount > 1)) return { sent: false, reason: "not-applicable" };
    const result = await sendRequestUpdate({ entityType: "RefundRequest", entityId: refund.id, shopId: refund.shopId, key: "REFUND_PAID", toPhone: request.customerPhoneSnapshot ?? request.customerProfile?.phoneE164 ?? null, variables: [firstName(request.customerNameSnapshot), refundAmountText(refund.amount, refund.currency), orderLabel(request.orderNumber)] });
    console.info("[REQUEST UPDATE]", { refundRequestId, key: "REFUND_PAID", ...result });
    return result;
  } catch (error) {
    console.error("[REQUEST UPDATE] refund_failed", { refundRequestId, error: error instanceof Error ? error.message : String(error) });
    return { sent: false, reason: "error" };
  }
}
