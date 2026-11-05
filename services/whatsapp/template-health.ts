// Template-message health for a merchant's WhatsApp number. Meta accepts a
// template send (OTP codes, order updates, nudges) and reports a failure later
// through the status webhook. When several fail in a row with an account-level
// error (an empty prepaid balance or a payment problem shows up as 130429 or
// 131042), nothing else tells the merchant: free replies in open chats still
// work. So the merchant gets one email (at most every 12 hours) and a banner in
// the admin until a template is delivered again.

import type { WebhookValue } from "./inbox.ts";

export const FAILURE_THRESHOLD = 5;
export const FAILURE_WINDOW_MS = 6 * 60 * 60 * 1000;
export const EMAIL_EVERY_MS = 12 * 60 * 60 * 1000;

// Account-level errors (not one customer's problem) and what to do about each.
export const ACCOUNT_ERRORS: Record<number, { cause: string; fix: string }> = {
  130429: {
    cause: "This usually means the WhatsApp account's prepaid balance has run out (Meta reports it as a rate limit).",
    fix: "In Meta Business Suite open Billing & payments → Messaging accounts, find this WhatsApp account and add funds (or fix its payment method).",
  },
  131042: {
    cause: "Meta reports a payment problem on the WhatsApp account.",
    fix: "In Meta Business Suite open Billing & payments → Messaging accounts, find this WhatsApp account and add funds or fix its payment method.",
  },
  131048: {
    cause: "Meta has limited this number because customers blocked or reported its messages.",
    fix: "Pause marketing messages (nudges, recovery) for a day or two and check the number's quality in WhatsApp Manager.",
  },
  131031: {
    cause: "Meta has locked or restricted this WhatsApp account.",
    fix: "Open WhatsApp Manager → Account quality for this account and follow Meta's instructions.",
  },
};
export const ACCOUNT_ERROR_CODES = Object.keys(ACCOUNT_ERRORS).map(Number);

// "130429 Rate limit hit" -> 130429; only account-level codes count.
export function accountErrorCode(error: string | null | undefined) {
  const code = Number(/^\s*(\d{5,6})\b/.exec(String(error ?? ""))?.[1]);
  return ACCOUNT_ERRORS[code] ? code : null;
}

export function failureAlertText(input: { phone: string; failures: number; code: number }) {
  const advice = ACCOUNT_ERRORS[input.code];
  return {
    subject: `WhatsApp messages from ${input.phone} are failing`,
    text: [
      `In the last few hours, ${input.failures} WhatsApp template messages from ${input.phone} were rejected by Meta with error ${input.code}.`,
      advice.cause,
      `What isn't reaching customers: OTP login codes, order updates (shipped, out for delivery, delivered, COD confirmations), checkout recovery and second-order nudges. Replies inside open chats, including the AI assistant's, still work. While this lasts, OTP codes go by SMS automatically when your OTP settings allow SMS.`,
      `How to fix it: ${advice.fix}`,
      "You'll get this email at most every 12 hours while the failures continue; the warning in the LoopD2C admin clears on its own once a template message is delivered again.",
    ].join("\n\n"),
  };
}

type Account = { shopId: string; displayPhoneNumber: string | null; templateFailingSince: Date | null; templateAlertEmailedAt: Date | null };

export type TemplateHealthDeps = {
  findAccount(phoneNumberId: string): Promise<Account | null>;
  // Is this WhatsApp message id one of our template sends (an OTP or a template in the inbox)?
  isTemplate(waMessageId: string): Promise<boolean>;
  recentFailures(shopId: string, since: Date): Promise<number>;
  markFailing(shopId: string, error: string, now: Date): Promise<void>;
  // Records the email time if it is still `previous` (so two webhooks don't both send).
  claimEmail(shopId: string, previous: Date | null, now: Date): Promise<boolean>;
  sendEmail(input: { shopId: string; subject: string; text: string; idempotencyKey: string }): Promise<void>;
  clear(shopId: string): Promise<void>;
  now(): Date;
};

export type TemplateHealthOutcome = "no_statuses" | "no_account" | "recovered" | "below_threshold" | "alerted" | "already_alerted" | "nothing";

export async function noteTemplateStatuses(value: WebhookValue, phoneNumberId: string, deps?: TemplateHealthDeps): Promise<TemplateHealthOutcome> {
  const statuses = (value.statuses || []).filter((status) => status.id && status.status);
  if (!statuses.length || !phoneNumberId) return "no_statuses";
  const d = deps ?? (await prismaTemplateHealthDeps());
  const account = await d.findAccount(phoneNumberId);
  if (!account) return "no_account";

  let delivered = false;
  let failure: { code: number; error: string } | null = null;
  for (const status of statuses) {
    const ok = status.status === "delivered" || status.status === "read";
    const errorText = status.status === "failed" ? (status.errors || []).map((e) => `${e.code ?? ""} ${e.title || e.message || ""}`.trim()).join("; ") : "";
    const code = status.status === "failed" ? accountErrorCode(errorText) : null;
    if (!ok && !code) continue;
    if (!(await d.isTemplate(String(status.id)))) continue;
    if (ok) delivered = true;
    else failure = { code: code!, error: errorText.slice(0, 300) };
  }

  const now = d.now();
  if (delivered && account.templateFailingSince && !failure) {
    await d.clear(account.shopId);
    return "recovered";
  }
  if (!failure) return "nothing";
  const failures = await d.recentFailures(account.shopId, new Date(now.getTime() - FAILURE_WINDOW_MS));
  if (failures < FAILURE_THRESHOLD) return "below_threshold";
  await d.markFailing(account.shopId, failure.error, now);
  if (account.templateAlertEmailedAt && now.getTime() - account.templateAlertEmailedAt.getTime() < EMAIL_EVERY_MS) return "already_alerted";
  if (!(await d.claimEmail(account.shopId, account.templateAlertEmailedAt, now))) return "already_alerted";
  const email = failureAlertText({ phone: account.displayPhoneNumber || "your WhatsApp number", failures, code: failure.code });
  await d.sendEmail({ shopId: account.shopId, ...email, idempotencyKey: `whatsapp-template-health:${account.shopId}:${now.toISOString().slice(0, 13)}` });
  return "alerted";
}

export async function prismaTemplateHealthDeps(): Promise<TemplateHealthDeps> {
  const [{ prisma }, { sendAdminAlert }] = await Promise.all([import("../db/prisma.ts"), import("../notifications/resend.ts")]);
  const codes = ACCOUNT_ERROR_CODES.map(String);
  return {
    findAccount: (phoneNumberId) => prisma.merchantWhatsAppAccount.findFirst({ where: { phoneNumberId, enabled: true }, select: { shopId: true, displayPhoneNumber: true, templateFailingSince: true, templateAlertEmailedAt: true } }),
    isTemplate: async (waMessageId) => {
      const [message, otp] = await Promise.all([
        prisma.whatsAppMessage.findUnique({ where: { waMessageId }, select: { templateName: true } }),
        prisma.oTPChallenge.findFirst({ where: { provider: "whatsapp", providerSid: waMessageId }, select: { id: true } }),
      ]);
      return Boolean(message?.templateName || otp);
    },
    recentFailures: async (shopId, since) => {
      const [templates, otps] = await Promise.all([
        prisma.whatsAppMessage.count({ where: { direction: "OUTBOUND", status: "failed", templateName: { not: null }, createdAt: { gt: since }, conversation: { shopId }, OR: codes.map((code) => ({ errorMessage: { startsWith: code } })) } }),
        prisma.oTPChallenge.count({ where: { shopId, provider: "whatsapp", createdAt: { gt: since }, OR: codes.map((code) => ({ metadata: { path: ["delivery", "error"], string_starts_with: code } })) } }),
      ]);
      return templates + otps;
    },
    markFailing: async (shopId, error, now) => {
      await prisma.merchantWhatsAppAccount.updateMany({ where: { shopId, templateFailingSince: null }, data: { templateFailingSince: now } });
      await prisma.merchantWhatsAppAccount.update({ where: { shopId }, data: { templateFailureError: error } });
    },
    claimEmail: async (shopId, previous, now) => (await prisma.merchantWhatsAppAccount.updateMany({ where: { shopId, templateAlertEmailedAt: previous }, data: { templateAlertEmailedAt: now } })).count === 1,
    sendEmail: async ({ shopId, subject, text, idempotencyKey }) => {
      const result = await sendAdminAlert({ shopId, eventType: "GENERAL", subject, text, usageContext: { sourceType: "WHATSAPP_TEMPLATE_HEALTH", sourceId: shopId, idempotencyKey, metadata: {} } });
      console.info("[WHATSAPP TEMPLATE HEALTH] alert_email", { shopId, result });
    },
    clear: async (shopId) => { await prisma.merchantWhatsAppAccount.update({ where: { shopId }, data: { templateFailingSince: null, templateFailureError: null } }); },
    now: () => new Date(),
  };
}
