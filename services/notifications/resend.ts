import { getMerchantNotificationRoutingSettings, type NotificationSettingsDb } from "../settings/merchant-notifications.ts";

export type AdminAlertEventType = "CANCELLATION" | "EXCHANGE" | "ISSUE" | "STORE_CREDIT" | "CHECKOUT" | "GENERAL";

export type SendAdminAlertInput = {
  shopId: string;
  eventType: AdminAlertEventType;
  subject: string;
  text: string;
};

export type AdminAlertSkipReason = "EMAIL_DISABLED" | "EVENT_DISABLED" | "NO_RECIPIENTS" | "PLATFORM_TRANSPORT_NOT_CONFIGURED";

export type SendResult =
  | { skipped: true; success?: undefined; reason: AdminAlertSkipReason }
  | { skipped: false; success: true; messageId: string | null }
  | { skipped: false; success: false; errorCode?: string | null };

type SendAdminAlertDeps = {
  db?: NotificationSettingsDb;
  fetchImpl?: typeof fetch;
};

function parseRecipients(value: string | undefined) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getPlatformAdminEmailTransport() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const platformFromEmail = String(process.env.OPS_NOTIFICATION_FROM_EMAIL || "").trim();
  return { apiKey, platformFromEmail, enabled: Boolean(apiKey && platformFromEmail) };
}

function getLegacyAdminRecipients() {
  return parseRecipients(process.env.ADMIN_ALERT_EMAIL || process.env.OPS_NOTIFICATION_TO_EMAIL);
}

function isEventEnabled(eventType: AdminAlertEventType, settings: Awaited<ReturnType<typeof getMerchantNotificationRoutingSettings>>) {
  const preferenceByEvent: Record<Exclude<AdminAlertEventType, "GENERAL">, boolean> = {
    CANCELLATION: settings.cancellationAlerts,
    EXCHANGE: settings.exchangeAlerts,
    ISSUE: settings.issueAlerts,
    STORE_CREDIT: settings.storeCreditAlerts,
    CHECKOUT: settings.checkoutAlerts,
  };
  return eventType === "GENERAL" ? true : preferenceByEvent[eventType];
}

function boundedSubject(subject: string) {
  return subject.slice(0, 120);
}

function sanitizeDisplayName(value: string | null | undefined) {
  const sanitized = String(value || "")
    .replace(/[\r\n\u0000-\u001F\u007F]+/g, " ")
    .replace(/["<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitized)) return "LoopDesk";
  return sanitized.slice(0, 100);
}

export function formatPlatformFrom(displayName: string | null | undefined, platformFromEmail: string) {
  return `${sanitizeDisplayName(displayName)} <${platformFromEmail}>`;
}

function log(operation: string, details: Record<string, unknown>) {
  console.info("[ADMIN NOTIFY]", { operation, ...details });
}

export async function sendAdminAlert(input: SendAdminAlertInput, deps: SendAdminAlertDeps = {}): Promise<SendResult> {
  const shopId = String(input.shopId || "").trim();
  const eventType = input.eventType;
  const subject = String(input.subject || "");
  const text = String(input.text || "");

  if (!shopId) {
    log("shop_unresolved", { shopId, eventType, subject: boundedSubject(subject) });
    return { skipped: false, success: false, errorCode: "SHOP_UNRESOLVED" };
  }

  let settings: Awaited<ReturnType<typeof getMerchantNotificationRoutingSettings>>;
  try {
    settings = await getMerchantNotificationRoutingSettings(shopId, deps.db);
  } catch (error) {
    log("shop_unresolved", { shopId, eventType, subject: boundedSubject(subject), errorName: error instanceof Error ? error.name : null });
    return { skipped: false, success: false, errorCode: "SHOP_UNRESOLVED" };
  }

  if (!settings.emailEnabled) {
    log("skipped_email_disabled", { shopId, eventType, hasSettingsRow: settings.hasSettingsRow, subject: boundedSubject(subject) });
    return { skipped: true, reason: "EMAIL_DISABLED" };
  }

  if (!isEventEnabled(eventType, settings)) {
    log("skipped_event_disabled", { shopId, eventType, hasSettingsRow: settings.hasSettingsRow, subject: boundedSubject(subject) });
    return { skipped: true, reason: "EVENT_DISABLED" };
  }

  const legacyRecipients = settings.hasSettingsRow ? [] : getLegacyAdminRecipients();
  const recipients = settings.hasSettingsRow ? settings.adminRecipients : legacyRecipients;
  const usedLegacyFallback = !settings.hasSettingsRow && recipients.length > 0;

  if (!recipients.length) {
    log("skipped_no_recipients", { shopId, eventType, hasSettingsRow: settings.hasSettingsRow, usedLegacyFallback: false, subject: boundedSubject(subject) });
    return { skipped: true, reason: "NO_RECIPIENTS" };
  }

  if (usedLegacyFallback) {
    log("legacy_recipient_fallback", { shopId, eventType, recipientCount: recipients.length });
  }

  const transport = getPlatformAdminEmailTransport();
  if (!transport.enabled) {
    log("transport_missing", { shopId, eventType, recipientCount: recipients.length, hasApiKey: Boolean(transport.apiKey), hasFrom: Boolean(transport.platformFromEmail), subject: boundedSubject(subject) });
    return { skipped: true, reason: "PLATFORM_TRANSPORT_NOT_CONFIGURED" };
  }

  log("routing_resolved", { shopId, eventType, recipientCount: recipients.length, hasSettingsRow: settings.hasSettingsRow, usedLegacyFallback, subject: boundedSubject(subject) });

  try {
    const body: Record<string, unknown> = {
      from: formatPlatformFrom(settings.senderDisplayName || settings.shopName, transport.platformFromEmail),
      to: recipients,
      subject,
      text,
    };
    if (settings.replyToEmail) body.reply_to = settings.replyToEmail;

    const response = await (deps.fetchImpl || fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${transport.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok) throw new Error(data?.message || `Resend HTTP ${response.status}`);
    log("provider_accepted", { shopId, eventType, recipientCount: recipients.length, providerMessageId: data?.id || null });
    return { skipped: false, success: true, messageId: data?.id || null };
  } catch (error) {
    console.error("[ADMIN NOTIFY]", { operation: "provider_failed", shopId, eventType, subject: boundedSubject(subject), errorName: error instanceof Error ? error.name : null, errorMessage: error instanceof Error ? error.message : String(error) });
    return { skipped: false, success: false, errorCode: "PROVIDER_FAILED" };
  }
}
