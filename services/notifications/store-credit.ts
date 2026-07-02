import { prisma } from "../db/prisma";
import { sendCustomerEmail } from "./email";

type StoreCreditEvent = "COD_REFUND_CREDIT" | "MANUAL_CREDIT" | "GOODWILL_CREDIT" | "CHECKOUT_REDEMPTION";

type StoreCreditEmailPayload = {
  event: StoreCreditEvent;
  customerEmail?: string | null;
  customerName?: string | null;
  amount: number;
  currency: string;
  balanceAfter?: number | null;
  orderNumber?: string | null;
  reason?: string | null;
  walletTransactionId?: string | null;
  sourceId?: string | null;
};

function formatAmount(amountMinor: number, currency: string) {
  const amount = (Number(amountMinor || 0) / 100).toFixed(2);
  return `${currency} ${amount}`;
}

function firstName(name?: string | null) {
  return String(name || "").trim().split(/\s+/)[0] || "there";
}

function subjectForEvent(event: StoreCreditEvent) {
  if (event === "CHECKOUT_REDEMPTION") return "Megaska Store Credit used on your order";
  return "Megaska Store Credit added to your account";
}

function buildStoreCreditText(payload: StoreCreditEmailPayload) {
  const lines = [`Hi ${firstName(payload.customerName)},`, ""];

  if (payload.event === "CHECKOUT_REDEMPTION") {
    lines.push(`You used ${formatAmount(payload.amount, payload.currency)} of Megaska Store Credit on your order.`);
  } else if (payload.event === "COD_REFUND_CREDIT") {
    lines.push(`Your COD refund of ${formatAmount(payload.amount, payload.currency)} has been added as Megaska Store Credit.`);
  } else if (payload.event === "GOODWILL_CREDIT") {
    lines.push(`We've added ${formatAmount(payload.amount, payload.currency)} of goodwill Store Credit to your account.`);
  } else {
    lines.push(`${formatAmount(payload.amount, payload.currency)} of Store Credit has been added to your account.`);
  }

  if (payload.orderNumber) lines.push(`Order: ${payload.orderNumber}`);
  if (payload.reason) lines.push(`Reason: ${payload.reason}`);
  if (typeof payload.balanceAfter === "number") {
    lines.push(`Available Store Credit balance: ${formatAmount(payload.balanceAfter, payload.currency)}`);
  }

  lines.push("", "You can use available Store Credit during checkout.", "", "Megaska Team");
  return lines.join("\n");
}

async function logAndSend(payload: StoreCreditEmailPayload) {
  const context = {
    event: payload.event,
    walletTransactionId: payload.walletTransactionId || null,
    sourceId: payload.sourceId || null,
  };

  if (!payload.customerEmail) {
    console.info("[STORE CREDIT NOTIFY] skipped", { ...context, reason: "missing-customer-email" });
    return;
  }

  const result = await sendCustomerEmail(payload.customerEmail, subjectForEvent(payload.event), buildStoreCreditText(payload));

  if (result.skipped) {
    console.info("[STORE CREDIT NOTIFY] skipped", { ...context, reason: "email-provider-config-or-recipient", providerMessageId: result.messageId || null });
    return;
  }

  if (result.success) {
    console.info("[STORE CREDIT NOTIFY] sent", { ...context, providerMessageId: result.messageId || null });
    return;
  }

  console.error("[STORE CREDIT NOTIFY] failed", { ...context, providerMessageId: result.messageId || null });
}

async function notifyFromWalletTransactionId(walletTransactionId: string, expectedType: StoreCreditEvent) {
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    customerProfileId: string;
    transactionType: string;
    amount: number;
    currency: string;
    orderNumber: string | null;
    reason: string | null;
    sourceId: string | null;
    fullName: string | null;
    firstName: string | null;
    email: string | null;
    currentBalance: number | null;
  }>>`
    SELECT wt."id", wt."customerProfileId", wt."transactionType", wt."amount", wt."currency", wt."orderNumber",
      wt."reason", wt."sourceId", cp."fullName", cp."firstName", cp."email", wa."currentBalance"
    FROM "WalletTransaction" wt
    JOIN "CustomerProfile" cp ON cp."id" = wt."customerProfileId"
    LEFT JOIN "WalletAccount" wa ON wa."id" = wt."walletAccountId"
    WHERE wt."id" = ${walletTransactionId}
    LIMIT 1
  `;
  const transaction = rows[0];

  if (!transaction) {
    console.info("[STORE CREDIT NOTIFY] skipped", { event: expectedType, walletTransactionId, reason: "wallet-transaction-not-found" });
    return;
  }

  if (transaction.transactionType !== expectedType) {
    console.info("[STORE CREDIT NOTIFY] skipped", { event: expectedType, walletTransactionId, reason: "transaction-type-mismatch", actualType: transaction.transactionType });
    return;
  }

  await logAndSend({
    event: expectedType,
    customerEmail: transaction.email,
    customerName: transaction.fullName || transaction.firstName,
    amount: transaction.amount,
    currency: transaction.currency,
    balanceAfter: transaction.currentBalance,
    orderNumber: transaction.orderNumber,
    reason: transaction.reason,
    walletTransactionId: transaction.id,
    sourceId: transaction.sourceId,
  });
}

export function notifyCodRefundStoreCreditSettled(input: { walletTransactionId: string; alreadySettled?: boolean }) {
  if (input.alreadySettled) {
    console.info("[STORE CREDIT NOTIFY] skipped", { event: "COD_REFUND_CREDIT", walletTransactionId: input.walletTransactionId, reason: "already-settled" });
    return;
  }

  void notifyFromWalletTransactionId(input.walletTransactionId, "COD_REFUND_CREDIT").catch((error) => {
    console.error("[STORE CREDIT NOTIFY] failed", { event: "COD_REFUND_CREDIT", walletTransactionId: input.walletTransactionId, error: error instanceof Error ? error.message : "Unknown error" });
  });
}

export function notifyManualStoreCreditApplied(input: { walletTransactionId: string; transactionType: "MANUAL_CREDIT" | "GOODWILL_CREDIT" | string }) {
  if (input.transactionType !== "MANUAL_CREDIT" && input.transactionType !== "GOODWILL_CREDIT") {
    console.info("[STORE CREDIT NOTIFY] skipped", { event: "MANUAL_CREDIT", walletTransactionId: input.walletTransactionId, reason: "unsupported-transaction-type", transactionType: input.transactionType });
    return;
  }

  void notifyFromWalletTransactionId(input.walletTransactionId, input.transactionType).catch((error) => {
    console.error("[STORE CREDIT NOTIFY] failed", { event: input.transactionType, walletTransactionId: input.walletTransactionId, error: error instanceof Error ? error.message : "Unknown error" });
  });
}

export function notifyCheckoutStoreCreditRedeemed(input: { walletTransactionId?: string | null; skipped?: boolean; reason?: string | null }) {
  if (input.skipped || !input.walletTransactionId) {
    console.info("[STORE CREDIT NOTIFY] skipped", { event: "CHECKOUT_REDEMPTION", walletTransactionId: input.walletTransactionId || null, reason: input.reason || "idempotent-or-missing-wallet-transaction" });
    return;
  }

  void notifyFromWalletTransactionId(input.walletTransactionId, "CHECKOUT_REDEMPTION").catch((error) => {
    console.error("[STORE CREDIT NOTIFY] failed", { event: "CHECKOUT_REDEMPTION", walletTransactionId: input.walletTransactionId, error: error instanceof Error ? error.message : "Unknown error" });
  });
}

export const __private__ = { buildStoreCreditText, subjectForEvent, formatAmount };
