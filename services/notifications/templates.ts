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
  const amount = `₹${((typeof payload.paymentAmountPaise === "number" ? payload.paymentAmountPaise : 12000) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  // Short and to the point: one action (pay the pickup charge), then the pickup is
  // booked automatically.
  return {
    subject: `Exchange approved: pay ${amount} to book your pickup (order #${payload.orderNumber})`,
    text: [
      `Hi ${payload.customerName || "there"},`,
      "",
      `Good news: your exchange for order #${payload.orderNumber} is approved${payload.requestedSize ? ` (new size: ${payload.requestedSize})` : ""}.`,
      "",
      `To collect your item, please pay the ${amount} reverse pickup charge:`,
      payload.paymentLinkUrl ? payload.paymentLinkUrl : `Open your account page: ${buildCustomerExchangeUrl(payload.requestId)}`,
      "",
      "Your address is already filled in, so it takes less than a minute (UPI or card). As soon as it's paid, we book the pickup and send you the tracking details.",
      payload.paymentLinkUrl ? `\nYou can also see this exchange on your account page: ${buildCustomerExchangeUrl(payload.requestId)}` : "",
    ]
      .filter((line) => line !== undefined)
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
