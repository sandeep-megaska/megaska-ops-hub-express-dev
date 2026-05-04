import { EXCHANGE_STATUS_DESCRIPTIONS } from "../exchange/lifecycle";
import { sendCustomerEmail, sendOpsAlert } from "./email";
import {
  buildExchangePaymentReceivedOpsTemplate,
  buildExchangePaymentRequiredCustomerTemplate,
  buildExchangeRequestedOpsTemplate,
} from "./templates";

type ExchangeNotifyPayload = {
  requestId: string;
  orderNumber: string;
  status: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  itemTitle?: string | null;
  currentSize?: string | null;
  requestedSize?: string | null;
  customerNote?: string | null;
  adminNote?: string | null;
  paymentAmountPaise?: number | null;
  paymentCurrency?: string | null;
  paymentLinkUrl?: string | null;
};

function buildBody(payload: ExchangeNotifyPayload) {
  const appBaseUrl = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  const adminUrl = appBaseUrl
    ? `${appBaseUrl}/admin/exchanges/${encodeURIComponent(payload.requestId)}`
    : "-";
  const statusDescription =
    EXCHANGE_STATUS_DESCRIPTIONS[payload.status] || payload.status;

  return [
    `Request ID: ${payload.requestId}`,
    `Order Number: ${payload.orderNumber}`,
    `Current Status: ${payload.status} (${statusDescription})`,
    `Customer Name: ${payload.customerName || "-"}`,
    `Customer Phone: ${payload.customerPhone || "-"}`,
    `Customer Email: ${payload.customerEmail || "-"}`,
    `Product Title: ${payload.itemTitle || "-"}`,
    `Current Size: ${payload.currentSize || "-"}`,
    `Requested Size: ${payload.requestedSize || "-"}`,
    `Customer Note: ${payload.customerNote || "-"}`,
    `Admin Note: ${payload.adminNote || "-"}`,
    `Admin URL: ${adminUrl}`,
  ].join("\n");
}

export async function sendExchangeTeamAlert(
  eventName: string,
  subject: string,
  payload: ExchangeNotifyPayload
) {
  const result = await sendOpsAlert(subject, buildBody(payload));

  if (result.skipped) return;

  if (result.success) {
    console.info("[EXCHANGE NOTIFY] Email sent", {
      requestId: payload.requestId,
      eventName,
      providerMessageId: result.messageId || null,
    });
    return;
  }

  console.error("[EXCHANGE NOTIFY] Email failed", {
    requestId: payload.requestId,
    eventName,
  });
}

export async function sendExchangeRequestCreatedEmail(payload: ExchangeNotifyPayload) {
  const template = buildExchangeRequestedOpsTemplate(payload);
  await sendOpsAlert(template.subject, template.text);
}

export async function sendExchangeStatusChangedEmail(payload: ExchangeNotifyPayload) {
  const eventByStatus: Record<string, { event: string; subject: string } | undefined> = {
    APPROVED: { event: "APPROVED", subject: `Exchange approved: #${payload.orderNumber}` },
    REJECTED: { event: "REJECTED", subject: `Exchange rejected: #${payload.orderNumber}` },
    PICKUP_COMPLETED: {
      event: "REVERSE_PICKUP_COMPLETED",
      subject: `Reverse pickup completed: #${payload.orderNumber}`,
    },
    REPLACEMENT_SHIPPED: {
      event: "REPLACEMENT_SHIPPED",
      subject: `Replacement shipped: #${payload.orderNumber}`,
    },
    CLOSED: { event: "CLOSED", subject: `Exchange closed: #${payload.orderNumber}` },
  };

  const config = eventByStatus[payload.status];
  if (!config) return;

  await sendExchangeTeamAlert(config.event, config.subject, payload);
}

export async function sendExchangeApprovedPaymentRequiredEmail(
  payload: ExchangeNotifyPayload
) {
  const template = buildExchangePaymentRequiredCustomerTemplate(payload);
  const result = await sendCustomerEmail(
    payload.customerEmail,
    template.subject,
    template.text
  );

  if (!result.success && !result.skipped) {
    console.error("[EXCHANGE NOTIFY] Customer payment-required email failed", {
      requestId: payload.requestId,
    });
  }
}

export async function sendExchangePaymentReceivedOpsEmail(
  payload: ExchangeNotifyPayload
) {
  const template = buildExchangePaymentReceivedOpsTemplate(payload);
  await sendOpsAlert(template.subject, template.text);
}


export async function sendExchangeInvoiceEmail(invoice: {
  invoiceNumber: string;
  customerEmail: string | null;
  orderNumber: string;
  totalPaise: number;
  currency: string;
  requestId: string;
}) {
  const appBaseUrl = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  const invoiceLink = appBaseUrl
    ? `${appBaseUrl}/api/account/exchange-requests/${encodeURIComponent(invoice.requestId)}/invoice`
    : "";
  const amount = `${invoice.currency} ${(invoice.totalPaise / 100).toFixed(2)}`;
  const subject = `GST invoice ${invoice.invoiceNumber} for order #${invoice.orderNumber}`;
  const text = [
    `Invoice Number: ${invoice.invoiceNumber}`,
    `Order Number: ${invoice.orderNumber}`,
    `Amount Paid: ${amount}`,
    invoiceLink ? `Invoice Link: ${invoiceLink}` : "",
  ].filter(Boolean).join("\n");

  await sendCustomerEmail(invoice.customerEmail, subject, text);
}
