import { sendAdminAlert } from "./resend.ts";

export type IssueNotifyPayload = {
  shopId: string;
  requestId: string;
  orderNumber: string;
  status: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  itemTitle?: string | null;
  variantTitle?: string | null;
  reason?: string | null;
  customerNote?: string | null;
  adminNote?: string | null;
};

function buildBody(payload: IssueNotifyPayload) {
  const appBaseUrl = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  const adminUrl = appBaseUrl ? `${appBaseUrl}/admin/issues/${encodeURIComponent(payload.requestId)}` : "-";

  return [
    `Request ID: ${payload.requestId}`,
    `Order Number: ${payload.orderNumber}`,
    `Current Status: ${payload.status}`,
    `Customer Name: ${payload.customerName || "-"}`,
    `Customer Phone: ${payload.customerPhone || "-"}`,
    `Customer Email: ${payload.customerEmail || "-"}`,
    `Product Title: ${payload.itemTitle || "-"}`,
    `Variant Title: ${payload.variantTitle || "-"}`,
    `Issue Reason: ${payload.reason || "-"}`,
    `Customer Note: ${payload.customerNote || "-"}`,
    `Admin Note: ${payload.adminNote || "-"}`,
    `Admin URL: ${adminUrl}`,
  ].join("\n");
}

export async function sendIssueTeamAlert(
  eventName: string,
  subject: string,
  payload: IssueNotifyPayload
) {
  const result = await sendAdminAlert({
    shopId: payload.shopId,
    eventType: "ISSUE",
    subject,
    text: buildBody(payload),
    usageContext: {
      sourceType: "ISSUE_REQUEST",
      sourceId: payload.requestId,
      idempotencyKey: `usage:email-send:${payload.shopId}:issue:${payload.requestId}:${eventName.toLowerCase().replace(/_/g, "-")}-admin`,
    },
  });

  if (result.skipped) return;

  if (result.success) {
    console.info("[ISSUE NOTIFY] Email sent", {
      requestId: payload.requestId,
      eventName,
      providerMessageId: result.messageId || null,
    });
    return;
  }

  console.error("[ISSUE NOTIFY] Email failed", {
    requestId: payload.requestId,
    eventName,
  });
}

export async function sendIssueRequestCreatedEmail(payload: IssueNotifyPayload) {
  await sendIssueTeamAlert(
    "REQUEST_CREATED",
    `New issue request: #${payload.orderNumber}`,
    payload
  );
}

export async function sendIssueStatusChangedEmail(payload: IssueNotifyPayload) {
  const eventByStatus: Record<string, { event: string; subject: string } | undefined> = {
    APPROVED: { event: "APPROVED", subject: `Issue approved: #${payload.orderNumber}` },
    REJECTED: { event: "REJECTED", subject: `Issue rejected: #${payload.orderNumber}` },
    PICKUP_PENDING: { event: "PICKUP_PENDING", subject: `Issue pickup pending: #${payload.orderNumber}` },
    PAYMENT_RECEIVED: { event: "PAYMENT_RECEIVED", subject: `Issue payment received: #${payload.orderNumber}` },
    CLOSED: { event: "CLOSED", subject: `Issue closed: #${payload.orderNumber}` },
  };

  const config = eventByStatus[payload.status];
  if (!config) return;

  await sendIssueTeamAlert(config.event, config.subject, payload);
}
