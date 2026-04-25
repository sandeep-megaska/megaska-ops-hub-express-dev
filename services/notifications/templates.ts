export type NotificationTemplate = {
  subject: string;
  text: string;
};

type ExchangeBase = {
  requestId: string;
  orderNumber: string;
  status: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  requestedSize?: string | null;
  currentSize?: string | null;
  customerNote?: string | null;
  adminNote?: string | null;
  paymentAmountPaise?: number | null;
  paymentCurrency?: string | null;
  paymentLinkUrl?: string | null;
};

function normalizeBaseUrl() {
  return String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
}

function buildAdminExchangeUrl(requestId: string) {
  const appBaseUrl = normalizeBaseUrl();
  return appBaseUrl
    ? `${appBaseUrl}/admin/exchanges/${encodeURIComponent(requestId)}`
    : "-";
}

function buildCustomerExchangeUrl(requestId: string) {
  const appBaseUrl = normalizeBaseUrl();
  return appBaseUrl
    ? `${appBaseUrl}/account/exchange-requests/${encodeURIComponent(requestId)}`
    : "-";
}

export function buildExchangeRequestedOpsTemplate(
  payload: ExchangeBase
): NotificationTemplate {
  return {
    subject: `New exchange request: #${payload.orderNumber}`,
    text: [
      `Request ID: ${payload.requestId}`,
      `Order Number: ${payload.orderNumber}`,
      `Current Status: ${payload.status}`,
      `Customer Name: ${payload.customerName || "-"}`,
      `Customer Phone: ${payload.customerPhone || "-"}`,
      `Customer Email: ${payload.customerEmail || "-"}`,
      `Current Size: ${payload.currentSize || "-"}`,
      `Requested Size: ${payload.requestedSize || "-"}`,
      `Customer Note: ${payload.customerNote || "-"}`,
      `Admin Note: ${payload.adminNote || "-"}`,
      `Admin URL: ${buildAdminExchangeUrl(payload.requestId)}`,
    ].join("\n"),
  };
}

export function buildExchangePaymentRequiredCustomerTemplate(
  payload: ExchangeBase
): NotificationTemplate {
  const amount =
    typeof payload.paymentAmountPaise === "number"
      ? (payload.paymentAmountPaise / 100).toFixed(2)
      : null;

  return {
    subject: `Exchange approved - reverse pickup payment required for #${payload.orderNumber}`,
    text: [
      `Hi ${payload.customerName || "Customer"},`,
      "",
      "Your exchange request has been approved by our ops team.",
      `Request ID: ${payload.requestId}`,
      `Order Number: ${payload.orderNumber}`,
      `Requested Size: ${payload.requestedSize || "-"}`,
      amount
        ? `Reverse Pickup Charge: ${payload.paymentCurrency || "INR"} ${amount}`
        : "Reverse Pickup Charge: INR 120.00",
      payload.paymentLinkUrl ? `Payment Link: ${payload.paymentLinkUrl}` : "",
      `Dashboard: ${buildCustomerExchangeUrl(payload.requestId)}`,
      "",
      "Please complete payment to schedule reverse pickup.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function buildExchangePaymentReceivedOpsTemplate(
  payload: ExchangeBase
): NotificationTemplate {
  return {
    subject: `Exchange reverse pickup payment received: #${payload.orderNumber}`,
    text: [
      `Request ID: ${payload.requestId}`,
      `Order Number: ${payload.orderNumber}`,
      `Current Status: ${payload.status}`,
      `Customer Name: ${payload.customerName || "-"}`,
      `Customer Phone: ${payload.customerPhone || "-"}`,
      `Customer Email: ${payload.customerEmail || "-"}`,
      `Current Size: ${payload.currentSize || "-"}`,
      `Requested Size: ${payload.requestedSize || "-"}`,
      `Admin URL: ${buildAdminExchangeUrl(payload.requestId)}`,
    ].join("\n"),
  };
}
