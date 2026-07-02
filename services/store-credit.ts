/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from "../generated/prisma";
import { prisma } from "./db/prisma";

type StoreCreditActor = {
  type: "SYSTEM" | "ADMIN";
  id?: string | null;
};

type SettleCodRefundAsStoreCreditInput = {
  refundRequestId: string;
  actor?: StoreCreditActor;
};

type StoreCreditTx = any;

type LoadedSettlement = Awaited<ReturnType<typeof loadExistingSettlement>>;

const REJECTED_SETTLEMENT_STATUSES = new Set(["REJECTED", "CANCELLED", "FAILED", "PAID", "NOT_REQUIRED"]);
const ALLOWED_SETTLEMENT_STATUSES = new Set(["MANUAL_PENDING", "APPROVED", "PAYOUT_PENDING"]);
const DEFAULT_REASON = "COD refund settled as Megaska Store Credit";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    (typeof error === "object" && error !== null && "code" in error)
  ) && (error as { code?: string }).code === "P2002";
}

function normalizeActor(actor: StoreCreditActor | undefined): Required<StoreCreditActor> {
  return {
    type: actor?.type || "SYSTEM",
    id: actor?.id || null,
  };
}

function validateRefundForStoreCredit(refund: {
  id: string;
  shopId: string | null;
  customerProfileId: string | null;
  method: string;
  amount: number;
  status: string;
  walletTransactionId: string | null;
}) {
  if (!refund.shopId) throw new Error("Refund request shopId is required");
  if (!refund.customerProfileId) throw new Error("Refund request customerProfileId is required");
  if (refund.method !== "COD") throw new Error("Only COD refund requests can be settled as store credit");
  if (!Number.isInteger(refund.amount) || refund.amount <= 0) throw new Error("Refund request amount must be positive");

  if (refund.walletTransactionId) return;

  if (REJECTED_SETTLEMENT_STATUSES.has(refund.status)) {
    throw new Error(`Refund request status ${refund.status} cannot be settled as store credit`);
  }
  if (!ALLOWED_SETTLEMENT_STATUSES.has(refund.status)) {
    throw new Error(`Refund request status ${refund.status} is not eligible for store credit settlement`);
  }
}

async function loadExistingSettlement(tx: StoreCreditTx, walletTransactionId: string) {
  const walletTransaction = await tx.walletTransaction.findUnique({
    where: { id: walletTransactionId },
    include: { walletAccount: true },
  });

  if (!walletTransaction) {
    throw new Error("Refund request wallet transaction was not found");
  }

  return {
    walletTransaction,
    walletAccount: walletTransaction.walletAccount,
  };
}

async function getOrCreateStoreCreditAccount(
  tx: StoreCreditTx,
  input: { shopId: string; customerProfileId: string; currency: string },
) {
  return tx.walletAccount.upsert({
    where: {
      shopId_customerProfileId_currency: {
        shopId: input.shopId,
        customerProfileId: input.customerProfileId,
        currency: input.currency,
      },
    },
    create: {
      shopId: input.shopId,
      customerProfileId: input.customerProfileId,
      currency: input.currency,
      currentBalance: 0,
    },
    update: {},
  });
}

async function recoverDuplicateSettlement(
  tx: StoreCreditTx,
  input: { refundRequestId: string; actor: Required<StoreCreditActor>; now: Date },
) {
  const refund = await tx.refundRequest.findUnique({ where: { id: input.refundRequestId } });
  if (!refund) throw new Error("Refund request not found");
  validateRefundForStoreCredit(refund);

  const walletTransaction = await tx.walletTransaction.findUnique({
    where: {
      sourceType_sourceId_transactionType: {
        sourceType: "REFUND_REQUEST",
        sourceId: refund.id,
        transactionType: "COD_REFUND_CREDIT",
      },
    },
    include: { walletAccount: true },
  });

  if (!walletTransaction) {
    throw new Error("Duplicate store credit settlement could not be recovered");
  }

  const updatedRefund = await tx.refundRequest.update({
    where: { id: refund.id },
    data: {
      status: "PAID",
      paidAt: refund.paidAt || input.now,
      walletTransactionId: walletTransaction.id,
    },
  });

  if (refund.status !== "PAID" || refund.walletTransactionId !== walletTransaction.id) {
    await tx.refundEvent.create({
      data: {
        refundRequestId: refund.id,
        actorType: input.actor.type,
        actorId: input.actor.id,
        eventType: "SETTLED_AS_STORE_CREDIT",
        fromStatus: refund.status,
        toStatus: "PAID",
        message: DEFAULT_REASON,
        payload: {
          walletAccountId: walletTransaction.walletAccountId,
          walletTransactionId: walletTransaction.id,
          amount: walletTransaction.amount,
          currency: walletTransaction.currency,
          sourceType: "REFUND_REQUEST",
          sourceId: refund.id,
        },
      },
    });
  }

  return {
    refundRequest: updatedRefund,
    walletAccount: walletTransaction.walletAccount,
    walletTransaction,
    alreadySettled: true,
  };
}

export async function settleCodRefundAsStoreCredit(input: SettleCodRefundAsStoreCreditInput) {
  const refundRequestId = String(input.refundRequestId || "").trim();
  if (!refundRequestId) throw new Error("refundRequestId is required");

  const actor = normalizeActor(input.actor);
  const now = new Date();

  console.info("[STORE CREDIT] settlement_start", { refundRequestId });

  try {
    const result = await (prisma as any).$transaction(async (tx: StoreCreditTx) => {
      const refund = await tx.refundRequest.findUnique({ where: { id: refundRequestId } });
      if (!refund) throw new Error("Refund request not found");

      validateRefundForStoreCredit(refund);

      if (refund.walletTransactionId) {
        const existing = await loadExistingSettlement(tx, refund.walletTransactionId);
        return {
          refundRequest: refund,
          walletAccount: existing.walletAccount,
          walletTransaction: existing.walletTransaction,
          alreadySettled: true,
          logStatus: "already-settled" as const,
        };
      }

      const duplicateTransaction = await tx.walletTransaction.findUnique({
        where: {
          sourceType_sourceId_transactionType: {
            sourceType: "REFUND_REQUEST",
            sourceId: refund.id,
            transactionType: "COD_REFUND_CREDIT",
          },
        },
        include: { walletAccount: true },
      });

      if (duplicateTransaction) {
        const recovered = await recoverDuplicateSettlement(tx, { refundRequestId: refund.id, actor, now });
        return { ...recovered, logStatus: "duplicate-recovered" as const };
      }

      const shopId = refund.shopId;
      const customerProfileId = refund.customerProfileId;
      if (!shopId || !customerProfileId) throw new Error("Refund request store credit identity is incomplete");

      const walletAccount = await getOrCreateStoreCreditAccount(tx, {
        shopId,
        customerProfileId,
        currency: refund.currency,
      });

      const walletTransaction = await tx.walletTransaction.create({
        data: {
          direction: "CREDIT",
          transactionType: "COD_REFUND_CREDIT",
          amount: refund.amount,
          currency: refund.currency,
          sourceType: "REFUND_REQUEST",
          sourceId: refund.id,
          sourceReference: refund.sourceId || refund.id,
          orderNumber: refund.shopifyOrderId || null,
          reason: refund.reason || DEFAULT_REASON,
          createdByType: actor.type,
          createdById: actor.id,
          shopId,
          customerProfileId,
          walletAccountId: walletAccount.id,
        },
      });

      const updatedWalletAccount = await tx.walletAccount.update({
        where: { id: walletAccount.id },
        data: { currentBalance: { increment: refund.amount } },
      });

      const updatedRefund = await tx.refundRequest.update({
        where: { id: refund.id },
        data: {
          status: "PAID",
          paidAt: now,
          walletTransactionId: walletTransaction.id,
        },
      });

      await tx.refundEvent.create({
        data: {
          refundRequestId: refund.id,
          actorType: actor.type,
          actorId: actor.id,
          eventType: "SETTLED_AS_STORE_CREDIT",
          fromStatus: refund.status,
          toStatus: "PAID",
          message: DEFAULT_REASON,
          payload: {
            walletAccountId: updatedWalletAccount.id,
            walletTransactionId: walletTransaction.id,
            amount: refund.amount,
            currency: refund.currency,
            sourceType: "REFUND_REQUEST",
            sourceId: refund.id,
          },
        },
      });

      return {
        refundRequest: updatedRefund,
        walletAccount: updatedWalletAccount,
        walletTransaction,
        alreadySettled: false,
        logStatus: "settled" as const,
      };
    });

    console.info(result.alreadySettled ? "[STORE CREDIT] already_settled" : "[STORE CREDIT] settlement_success", {
      refundRequestId: result.refundRequest.id,
      walletTransactionId: result.walletTransaction.id,
      walletAccountId: result.walletAccount.id,
    });

    const { logStatus: _logStatus, ...settlement } = result;
    return settlement;
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      console.error("[STORE CREDIT] settlement_failed", {
        refundRequestId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }

    const recovered = await (prisma as any).$transaction((tx: StoreCreditTx) => recoverDuplicateSettlement(tx, { refundRequestId, actor, now }));
    console.info("[STORE CREDIT] already_settled", {
      refundRequestId: recovered.refundRequest.id,
      walletTransactionId: recovered.walletTransaction.id,
      walletAccountId: recovered.walletAccount.id,
    });
    return recovered;
  }
}

export const __private__ = { getOrCreateStoreCreditAccount };

export type CustomerStoreCreditParams = {
  shopId: string;
  customerProfileId: string;
  currency?: string;
};

export type CustomerStoreCreditTransaction = {
  id: string;
  type: string;
  customerLabel: string;
  amount: number;
  direction: "credit" | "debit" | "neutral";
  reason: string | null;
  refundRequestId?: string | null;
  orderName?: string | null;
  createdAt: string;
};

const TRANSACTION_LABELS: Record<string, string> = {
  COD_REFUND_CREDIT: "Refund Credit",
  MANUAL_CREDIT: "Refund Credit",
  GOODWILL_CREDIT: "Refund Credit",
  MANUAL_DEBIT: "Store Credit Used",
  CHECKOUT_REDEMPTION: "Applied to Order",
  ADJUSTMENT: "Store Credit Adjustment",
};

function toCurrencyAmount(minorUnits: number | null | undefined) {
  return Number(((Number(minorUnits || 0)) / 100).toFixed(2));
}

function toCustomerDirection(direction: string): "credit" | "debit" | "neutral" {
  if (direction === "CREDIT") return "credit";
  if (direction === "DEBIT") return "debit";
  return "neutral";
}

function labelForTransaction(type: string, direction: string) {
  return TRANSACTION_LABELS[type] || (direction === "CREDIT" ? "Refund Credit" : direction === "DEBIT" ? "Store Credit Used" : "Store Credit Activity");
}

export async function getCustomerStoreCreditBalance(input: CustomerStoreCreditParams) {
  const currency = String(input.currency || "INR").trim() || "INR";
  const rows = await prisma.$queryRaw<Array<{ id: string; currentBalance: number; currency: string }>>`
    SELECT "id", "currentBalance", "currency"
    FROM "WalletAccount"
    WHERE "shopId" = ${input.shopId}
      AND "customerProfileId" = ${input.customerProfileId}
      AND "currency" = ${currency}
    LIMIT 1
  `;
  const account = rows[0] || null;

  const reservedRows = account
    ? await prisma.$queryRaw<Array<{ reservedAmount: number }>>`
        SELECT COALESCE(SUM("reservedAmount"), 0)::int AS "reservedAmount"
        FROM "WalletReservation"
        WHERE "walletAccountId" = ${account.id}
          AND "status" = 'ACTIVE'::"WalletReservationStatus"
          AND "expiresAt" > NOW()
      `
    : [];
  const ledgerBalance = Number(account?.currentBalance || 0);
  const reservedAmount = Number(reservedRows[0]?.reservedAmount || 0);
  const availableBalance = Math.max(0, ledgerBalance - reservedAmount);

  return {
    balance: toCurrencyAmount(availableBalance),
    availableBalance: toCurrencyAmount(availableBalance),
    ledgerBalance: toCurrencyAmount(ledgerBalance),
    reservedAmount: toCurrencyAmount(reservedAmount),
    currency: account?.currency || currency,
  };
}

export async function listCustomerStoreCreditTransactions(input: CustomerStoreCreditParams): Promise<CustomerStoreCreditTransaction[]> {
  const currency = String(input.currency || "INR").trim() || "INR";
  const transactions = await prisma.$queryRaw<Array<{
    id: string;
    direction: string;
    transactionType: string;
    amount: number;
    reason: string | null;
    sourceType: string;
    sourceId: string | null;
    sourceReference: string | null;
    orderNumber: string | null;
    createdAt: Date;
    refundRequestId: string | null;
    refundShopifyOrderId: string | null;
  }>>`
    SELECT wt."id", wt."direction"::text AS "direction", wt."transactionType"::text AS "transactionType",
      wt."amount", wt."reason", wt."sourceType"::text AS "sourceType", wt."sourceId", wt."sourceReference",
      wt."orderNumber", wt."createdAt", rr."id" AS "refundRequestId", rr."shopifyOrderId" AS "refundShopifyOrderId"
    FROM "WalletTransaction" wt
    LEFT JOIN "RefundRequest" rr
      ON rr."walletTransactionId" = wt."id"
      AND rr."shopId" = ${input.shopId}
      AND rr."customerProfileId" = ${input.customerProfileId}
    WHERE wt."shopId" = ${input.shopId}
      AND wt."customerProfileId" = ${input.customerProfileId}
      AND wt."currency" = ${currency}
    ORDER BY wt."createdAt" DESC
    LIMIT 50
  `;

  return transactions.map((transaction) => {
    const refundRequestId = transaction.sourceType === "REFUND_REQUEST"
      ? transaction.sourceId || transaction.refundRequestId || null
      : transaction.refundRequestId || null;

    return {
      id: transaction.id,
      type: transaction.transactionType,
      customerLabel: labelForTransaction(transaction.transactionType, transaction.direction),
      amount: toCurrencyAmount(transaction.amount),
      direction: toCustomerDirection(transaction.direction),
      reason: transaction.reason || null,
      refundRequestId,
      orderName: transaction.orderNumber || transaction.refundShopifyOrderId || transaction.sourceReference || null,
      createdAt: transaction.createdAt.toISOString(),
    };
  });
}
