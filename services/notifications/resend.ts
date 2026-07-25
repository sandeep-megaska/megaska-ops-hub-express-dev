import { randomUUID } from "node:crypto";
import { getMerchantNotificationRoutingSettings, type NotificationSettingsDb } from "../settings/merchant-notifications.ts";
import { recordAcceptedEmailUsage } from "../usage/email-usage.ts";

export type AdminAlertEventType = "CANCELLATION" | "EXCHANGE" | "ISSUE" | "STORE_CREDIT" | "CHECKOUT" | "GENERAL";
export type CustomerEmailEventType = AdminAlertEventType | "ORDER" | "REVIEW_REQUEST" | "REVIEW_REMINDER";

export type NotificationUsageContext = {
  sourceType?: string;
  sourceId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

export type SendAdminAlertInput = {
  shopId: string;
  eventType: AdminAlertEventType;
  subject: string;
  text: string;
  usageContext?: NotificationUsageContext;
};

export type SendCustomerEmailInput = {
  shopId: string;
  to: string | null | undefined;
  eventType: CustomerEmailEventType;
  subject: string;
  text: string;
  usageContext?: NotificationUsageContext;
};

export type AdminAlertSkipReason = "EMAIL_DISABLED" | "EVENT_DISABLED" | "NO_RECIPIENTS" | "PLATFORM_TRANSPORT_NOT_CONFIGURED";
export type CustomerEmailSkipReason = "EMAIL_DISABLED" | "CUSTOMER_EMAIL_DISABLED" | "NO_RECIPIENT" | "PLATFORM_TRANSPORT_NOT_CONFIGURED";

export type SendResult =
  | { skipped: true; success?: undefined; reason: AdminAlertSkipReason }
  | { skipped: false; success: true; messageId: string | null }
  | { skipped: false; success: false; errorCode?: string | null };

export type CustomerEmailSendResult =
  | { skipped: true; success?: undefined; reason: CustomerEmailSkipReason }
  | { skipped: false; success: true; messageId: string | null }
  | { skipped: false; success: false; errorCode?: string | null };

type SendAdminAlertDeps = {
  db?: NotificationSettingsDb;
  fetchImpl?: typeof fetch;
};

type SendCustomerEmailDeps = SendAdminAlertDeps;


function usageLog(operation: string, details: Record<string, unknown>) {
  console.info("[USAGE METER]", { operation, ...details });
}

async function safelyRecordEmailUsage(input: {
  shopId: string;
  audience: "ADMIN" | "CUSTOMER";
  eventType: string;
  providerMessageId: string | null;
  notificationAttemptId: string;
  recipientCount: number;
  usageContext?: NotificationUsageContext;
}, db?: NotificationSettingsDb) {
  try {
    const result = await recordAcceptedEmailUsage({
      shopId: input.shopId,
      notificationAudience: input.audience,
      eventType: input.eventType,
      providerMessageId: input.providerMessageId,
      notificationAttemptId: input.notificationAttemptId,
      recipientCount: input.recipientCount,
      sourceType: input.usageContext?.sourceType,
      sourceId: input.usageContext?.sourceId,
      idempotencyKey: input.usageContext?.idempotencyKey,
    }, db as Parameters<typeof recordAcceptedEmailUsage>[1]);
    usageLog(result.created ? "email_usage_recorded" : "email_usage_duplicate", {
      shopId: input.shopId,
      audience: input.audience,
      eventType: input.eventType,
      providerMessageId: input.providerMessageId,
      notificationAttemptId: input.notificationAttemptId,
      recipientCount: input.recipientCount,
      sourceType: input.usageContext?.sourceType || (input.providerMessageId ? "RESEND_MESSAGE" : "RESEND_ATTEMPT"),
      sourceId: input.usageContext?.sourceId || input.providerMessageId || input.notificationAttemptId,
      eventId: result.eventId,
      created: result.created,
    });
  } catch (error) {
    console.error("[USAGE METER]", {
      operation: "email_usage_record_failed",
      shopId: input.shopId,
      audience: input.audience,
      eventType: input.eventType,
      providerMessageId: input.providerMessageId,
      notificationAttemptId: input.notificationAttemptId,
      recipientCount: input.recipientCount,
      sourceType: input.usageContext?.sourceType || null,
      sourceId: input.usageContext?.sourceId || null,
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseRecipients(value: string | undefined) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export type ParsedPlatformSender = {
  email: string;
  configuredDisplayName: string | null;
};

function isValidSenderEmail(value: string) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254) return false;
  if (/[\r\n,<>]/.test(email)) return false;
  if ((email.match(/@/g) || []).length !== 1) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  return true;
}

export function parsePlatformSender(rawValue: string | null | undefined): ParsedPlatformSender | null {
  const raw = String(rawValue || "").trim();
  if (!raw || /[\r\n,]/.test(raw)) return null;

  const formatted = raw.match(/^([^<>]+?)\s*<\s*([^<>]+?)\s*>$/);
  if (formatted) {
    const configuredDisplayName = formatted[1].replace(/["<>]/g, "").replace(/\s+/g, " ").trim();
    const email = formatted[2].trim().toLowerCase();
    if (!configuredDisplayName || !isValidSenderEmail(email)) return null;
    return { email, configuredDisplayName: configuredDisplayName.slice(0, 100) };
  }

  if (raw.includes("<") || raw.includes(">")) return null;
  const email = raw.toLowerCase();
  if (!isValidSenderEmail(email)) return null;
  return { email, configuredDisplayName: null };
}

export function getPlatformAdminEmailTransport() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const rawPlatformSender = String(process.env.OPS_NOTIFICATION_FROM_EMAIL || "").trim();
  const parsedSender = parsePlatformSender(rawPlatformSender);
  return { apiKey, rawPlatformSender, parsedSender, enabled: Boolean(apiKey && parsedSender) };
}

export function getPlatformCustomerEmailTransport() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const rawPlatformSender = String(process.env.CUSTOMER_NOTIFICATION_FROM_EMAIL || process.env.OPS_NOTIFICATION_FROM_EMAIL || "").trim();
  const parsedSender = parsePlatformSender(rawPlatformSender);
  return { apiKey, rawPlatformSender, parsedSender, enabled: Boolean(apiKey && parsedSender) };
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
  if (!sanitized || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitized)) return "LoopD2C";
  return sanitized.slice(0, 100);
}

export function formatPlatformFrom(displayName: string | null | undefined, rawPlatformSender: string) {
  const parsedSender = parsePlatformSender(rawPlatformSender);
  if (!parsedSender) return null;
  const finalDisplayName = sanitizeDisplayName(displayName || parsedSender.configuredDisplayName || "LoopD2C");
  return `${finalDisplayName} <${parsedSender.email}>`;
}

function log(operation: string, details: Record<string, unknown>) {
  console.info("[ADMIN NOTIFY]", { operation, ...details });
}

function customerLog(operation: string, details: Record<string, unknown>) {
  console.info("[CUSTOMER NOTIFY]", { operation, ...details });
}

function normalizeCustomerRecipient(value: string | null | undefined) {
  const recipient = String(value || "").trim().toLowerCase();
  if (!recipient || recipient.length > 254) return null;
  if (/[\r\n]/.test(recipient) || recipient.includes(",")) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return null;
  return recipient;
}

function normalizeReplyTo(value: string | null | undefined) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || /[\r\n,]/.test(email)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
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
    log("transport_missing", { shopId, eventType, recipientCount: recipients.length, hasApiKey: Boolean(transport.apiKey), hasValidFrom: Boolean(transport.parsedSender), subject: boundedSubject(subject) });
    return { skipped: true, reason: "PLATFORM_TRANSPORT_NOT_CONFIGURED" };
  }

  log("routing_resolved", { shopId, eventType, recipientCount: recipients.length, hasSettingsRow: settings.hasSettingsRow, usedLegacyFallback, subject: boundedSubject(subject) });

  const from = formatPlatformFrom(settings.senderDisplayName || settings.shopName, transport.rawPlatformSender);
  if (!from) {
    log("transport_missing", { shopId, eventType, recipientCount: recipients.length, hasApiKey: Boolean(transport.apiKey), hasValidFrom: false, subject: boundedSubject(subject) });
    return { skipped: true, reason: "PLATFORM_TRANSPORT_NOT_CONFIGURED" };
  }

  const notificationAttemptId = randomUUID();

  try {
    const body: Record<string, unknown> = {
      from,
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
    const providerMessageId = data?.id || null;
    log("provider_accepted", { shopId, eventType, recipientCount: recipients.length, providerMessageId });
    await safelyRecordEmailUsage({ shopId, audience: "ADMIN", eventType, providerMessageId, notificationAttemptId, recipientCount: recipients.length, usageContext: input.usageContext }, deps.db);
    return { skipped: false, success: true, messageId: providerMessageId };
  } catch (error) {
    console.error("[ADMIN NOTIFY]", { operation: "provider_failed", shopId, eventType, subject: boundedSubject(subject), errorName: error instanceof Error ? error.name : null, errorMessage: error instanceof Error ? error.message : String(error) });
    return { skipped: false, success: false, errorCode: "PROVIDER_FAILED" };
  }
}

export async function sendCustomerEmail(input: SendCustomerEmailInput, deps: SendCustomerEmailDeps = {}): Promise<CustomerEmailSendResult> {
  const shopId = String(input.shopId || "").trim();
  const eventType = input.eventType;
  const subject = String(input.subject || "");
  const text = String(input.text || "");

  if (!shopId) {
    customerLog("shop_unresolved", { shopId, eventType, subject: boundedSubject(subject), recipientPresent: Boolean(String(input.to || "").trim()) });
    return { skipped: false, success: false, errorCode: "SHOP_UNRESOLVED" };
  }

  let settings: Awaited<ReturnType<typeof getMerchantNotificationRoutingSettings>>;
  try {
    settings = await getMerchantNotificationRoutingSettings(shopId, deps.db);
  } catch (error) {
    customerLog("shop_unresolved", { shopId, eventType, subject: boundedSubject(subject), recipientPresent: Boolean(String(input.to || "").trim()), errorName: error instanceof Error ? error.name : null });
    return { skipped: false, success: false, errorCode: "SHOP_UNRESOLVED" };
  }

  if (!settings.emailEnabled) {
    customerLog("skipped_email_disabled", { shopId, eventType, hasSettingsRow: settings.hasSettingsRow, subject: boundedSubject(subject), recipientPresent: Boolean(String(input.to || "").trim()) });
    return { skipped: true, reason: "EMAIL_DISABLED" };
  }

  if (!settings.customerEmailsEnabled) {
    customerLog("skipped_customer_email_disabled", { shopId, eventType, hasSettingsRow: settings.hasSettingsRow, subject: boundedSubject(subject), recipientPresent: Boolean(String(input.to || "").trim()) });
    return { skipped: true, reason: "CUSTOMER_EMAIL_DISABLED" };
  }

  const recipient = normalizeCustomerRecipient(input.to);
  if (!recipient) {
    customerLog("skipped_no_recipient", { shopId, eventType, hasSettingsRow: settings.hasSettingsRow, subject: boundedSubject(subject), recipientPresent: Boolean(String(input.to || "").trim()) });
    return { skipped: true, reason: "NO_RECIPIENT" };
  }

  const transport = getPlatformCustomerEmailTransport();
  if (!transport.enabled) {
    customerLog("transport_missing", { shopId, eventType, hasSettingsRow: settings.hasSettingsRow, hasApiKey: Boolean(transport.apiKey), hasValidFrom: Boolean(transport.parsedSender), subject: boundedSubject(subject), recipientPresent: true });
    return { skipped: true, reason: "PLATFORM_TRANSPORT_NOT_CONFIGURED" };
  }

  customerLog("routing_resolved", { shopId, eventType, hasSettingsRow: settings.hasSettingsRow, subject: boundedSubject(subject), recipientPresent: true });

  const from = formatPlatformFrom(settings.senderDisplayName || settings.shopName, transport.rawPlatformSender);
  if (!from) {
    customerLog("transport_missing", { shopId, eventType, hasSettingsRow: settings.hasSettingsRow, hasApiKey: Boolean(transport.apiKey), hasValidFrom: false, subject: boundedSubject(subject), recipientPresent: true });
    return { skipped: true, reason: "PLATFORM_TRANSPORT_NOT_CONFIGURED" };
  }

  const notificationAttemptId = randomUUID();

  try {
    const body: Record<string, unknown> = {
      from,
      to: [recipient],
      subject,
      text,
    };
    const replyTo = normalizeReplyTo(settings.replyToEmail);
    if (replyTo) body.reply_to = replyTo;

    const response = await (deps.fetchImpl || fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${transport.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok) throw new Error(data?.message || `Resend HTTP ${response.status}`);
    const providerMessageId = data?.id || null;
    customerLog("provider_accepted", { shopId, eventType, providerMessageId, subject: boundedSubject(subject), recipientPresent: true });
    await safelyRecordEmailUsage({ shopId, audience: "CUSTOMER", eventType, providerMessageId, notificationAttemptId, recipientCount: 1, usageContext: input.usageContext }, deps.db);
    return { skipped: false, success: true, messageId: providerMessageId };
  } catch (error) {
    console.error("[CUSTOMER NOTIFY]", { operation: "provider_failed", shopId, eventType, subject: boundedSubject(subject), recipientPresent: true, errorName: error instanceof Error ? error.name : null, errorMessage: error instanceof Error ? error.message : String(error) });
    return { skipped: false, success: false, errorCode: "PROVIDER_FAILED" };
  }
}

export type SendEmailVerificationCodeInput = {
  shopId: string;
  shopName?: string | null;
  to: string;
  code: string;
};

/**
 * Always-on transactional send for identity-verification codes. Deliberately bypasses
 * getMerchantNotificationRoutingSettings — a merchant disabling customer notifications
 * must never be able to silently break a security-critical verification step.
 */
export async function sendEmailVerificationCode(
  input: SendEmailVerificationCodeInput,
  deps: SendCustomerEmailDeps = {}
): Promise<CustomerEmailSendResult> {
  const shopId = String(input.shopId || "").trim();
  const recipient = normalizeCustomerRecipient(input.to);

  if (!shopId) {
    customerLog("shop_unresolved", { shopId, eventType: "GENERAL", recipientPresent: Boolean(recipient) });
    return { skipped: false, success: false, errorCode: "SHOP_UNRESOLVED" };
  }

  if (!recipient) {
    customerLog("skipped_no_recipient", { shopId, eventType: "GENERAL", recipientPresent: false });
    return { skipped: true, reason: "NO_RECIPIENT" };
  }

  const transport = getPlatformCustomerEmailTransport();
  if (!transport.enabled) {
    customerLog("transport_missing", { shopId, eventType: "GENERAL", hasApiKey: Boolean(transport.apiKey), hasValidFrom: Boolean(transport.parsedSender), recipientPresent: true });
    return { skipped: true, reason: "PLATFORM_TRANSPORT_NOT_CONFIGURED" };
  }

  const from = formatPlatformFrom(input.shopName, transport.rawPlatformSender);
  if (!from) {
    customerLog("transport_missing", { shopId, eventType: "GENERAL", hasApiKey: Boolean(transport.apiKey), hasValidFrom: false, recipientPresent: true });
    return { skipped: true, reason: "PLATFORM_TRANSPORT_NOT_CONFIGURED" };
  }

  const notificationAttemptId = randomUUID();
  const subject = `Your verification code: ${input.code}`;
  const text = `Your one-time verification code is ${input.code}. It expires in 10 minutes.\n\nIf you did not request this, you can safely ignore this email.`;

  try {
    const response = await (deps.fetchImpl || fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${transport.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [recipient], subject, text }),
    });
    const data = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok) throw new Error(data?.message || `Resend HTTP ${response.status}`);
    const providerMessageId = data?.id || null;
    customerLog("provider_accepted", { shopId, eventType: "GENERAL", providerMessageId, recipientPresent: true });
    await safelyRecordEmailUsage({ shopId, audience: "CUSTOMER", eventType: "GENERAL", providerMessageId, notificationAttemptId, recipientCount: 1 }, deps.db);
    return { skipped: false, success: true, messageId: providerMessageId };
  } catch (error) {
    console.error("[CUSTOMER NOTIFY]", { operation: "provider_failed", shopId, eventType: "GENERAL", recipientPresent: true, errorName: error instanceof Error ? error.name : null, errorMessage: error instanceof Error ? error.message : String(error) });
    return { skipped: false, success: false, errorCode: "PROVIDER_FAILED" };
  }
}
