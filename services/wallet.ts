import { Prisma } from "../generated/prisma";
import { prisma } from "./db/prisma";
import { randomUUID } from "crypto";

type WalletDirection = "CREDIT" | "DEBIT";
type WalletTransactionType = "COD_REFUND_CREDIT" | "MANUAL_CREDIT" | "MANUAL_DEBIT" | "ADJUSTMENT" | "GOODWILL_CREDIT" | "CHECKOUT_REDEMPTION";
type WalletSourceType = "ISSUE_REQUEST" | "ADMIN_MANUAL" | "WALLET_RESERVATION";
type WalletActorType = "SYSTEM" | "ADMIN";

export type WalletAccountRow = {
  id: string;
  shopId?: string;
  customerProfileId: string;
  currency: string;
  currentBalance: number;
  createdAt: Date;
  updatedAt: Date;
};

export type WalletTransactionRow = {
  id: string;
  walletAccountId: string;
  customerProfileId: string;
  direction: WalletDirection;
  transactionType: WalletTransactionType;
  amount: number;
  currency: string;
  sourceType: WalletSourceType;
  sourceId: string | null;
  sourceReference: string | null;
  orderNumber: string | null;
  reason: string | null;
  adminNote: string | null;
  createdByType: WalletActorType;
  createdById: string | null;
  createdAt: Date;
};

type WalletMutationInput = {
  customerProfileId: string;
  amount: number;
  currency?: string;
  direction: WalletDirection;
  transactionType: WalletTransactionType;
  sourceType: WalletSourceType;
  sourceId?: string | null;
  sourceReference?: string | null;
  orderNumber?: string | null;
  reason?: string | null;
  adminNote?: string | null;
  createdByType: WalletActorType;
  createdById?: string | null;
  allowNegativeBalance?: boolean;
};

export function parseAmountToMinorUnits(value: string | number) {
  const normalized = typeof value === "number" ? String(value) : String(value || "").trim();
  const match = normalized.replace(/,/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  if (!match) return 0;
  return Math.round(Number(match[0]) * 100);
}

export async function getOrCreateWalletAccount(customerProfileId: string, currency = "INR", shopId?: string | null) {
  const profileRows = await prisma.$queryRaw<Array<{ shopId: string }>>`
    SELECT "shopId" FROM "CustomerProfile" WHERE "id" = ${customerProfileId} LIMIT 1
  `;
  const resolvedShopId = String(shopId || profileRows[0]?.shopId || "").trim();
  if (!resolvedShopId) throw new Error("Customer shop scope required for Store Credit account");
  const walletId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "WalletAccount" ("id", "shopId", "customerProfileId", "currency", "currentBalance", "createdAt", "updatedAt")
    VALUES (${walletId}, ${resolvedShopId}, ${customerProfileId}, ${currency}, 0, NOW(), NOW())
    ON CONFLICT ("shopId", "customerProfileId", "currency") DO NOTHING
  `;

  const rows = await prisma.$queryRaw<WalletAccountRow[]>`
    SELECT "id", "shopId", "customerProfileId", "currency", "currentBalance", "createdAt", "updatedAt"
    FROM "WalletAccount"
    WHERE "shopId" = ${resolvedShopId} AND "customerProfileId" = ${customerProfileId} AND "currency" = ${currency}
    LIMIT 1
  `;

  if (!rows[0]) {
    throw new Error("Failed to create or load wallet account");
  }

  return rows[0];
}

export async function listWalletTransactions(customerProfileId: string, currency = "INR", limit = 15) {
  return prisma.$queryRaw<WalletTransactionRow[]>`
    SELECT "id", "walletAccountId", "customerProfileId", "direction", "transactionType", "amount", "currency",
      "sourceType", "sourceId", "sourceReference", "orderNumber", "reason", "adminNote", "createdByType", "createdById", "createdAt"
    FROM "WalletTransaction"
    WHERE "customerProfileId" = ${customerProfileId} AND "currency" = ${currency}
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `;
}

export async function applyWalletTransaction(input: WalletMutationInput) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("amount must be a positive integer in minor currency units");
  }

  const currency = String(input.currency || "INR").trim() || "INR";

  return prisma.$transaction(async (tx) => {
    const walletId = randomUUID();
    await tx.$executeRaw`
      INSERT INTO "WalletAccount" ("id", "shopId", "customerProfileId", "currency", "currentBalance", "createdAt", "updatedAt")
      SELECT ${walletId}, cp."shopId", ${input.customerProfileId}, ${currency}, 0, NOW(), NOW() FROM "CustomerProfile" cp WHERE cp."id" = ${input.customerProfileId}
      ON CONFLICT ("shopId", "customerProfileId", "currency") DO NOTHING
    `;

    const accounts = await tx.$queryRaw<WalletAccountRow[]>`
      SELECT "id", "shopId", "customerProfileId", "currency", "currentBalance", "createdAt", "updatedAt"
      FROM "WalletAccount"
      WHERE "customerProfileId" = ${input.customerProfileId} AND "currency" = ${currency}
      LIMIT 1
    `;

    const wallet = accounts[0];
    if (!wallet) throw new Error("Wallet account not found");

    const nextBalance = input.direction === "CREDIT" ? wallet.currentBalance + input.amount : wallet.currentBalance - input.amount;
    if (nextBalance < 0 && !input.allowNegativeBalance) {
      throw new Error("Insufficient wallet balance for debit");
    }

    const transactionId = randomUUID();
    const transactionRows = await tx.$queryRaw<WalletTransactionRow[]>`
      INSERT INTO "WalletTransaction" (
        "id", "shopId", "walletAccountId", "customerProfileId", "direction", "transactionType", "amount", "currency",
        "sourceType", "sourceId", "sourceReference", "orderNumber", "reason", "adminNote", "createdByType", "createdById", "createdAt"
      ) VALUES (
        ${transactionId}, ${wallet.shopId}, ${wallet.id}, ${input.customerProfileId}, ${input.direction}::"WalletDirection",
        ${input.transactionType}::"WalletTransactionType", ${input.amount}, ${currency}, ${input.sourceType}::"WalletSourceType",
        ${input.sourceId || null}, ${input.sourceReference || null}, ${input.orderNumber || null}, ${input.reason || null},
        ${input.adminNote || null}, ${input.createdByType}::"WalletActorType", ${input.createdById || null}, NOW()
      )
      RETURNING "id", "walletAccountId", "customerProfileId", "direction", "transactionType", "amount", "currency",
        "sourceType", "sourceId", "sourceReference", "orderNumber", "reason", "adminNote", "createdByType", "createdById", "createdAt"
    `;

    const updatedRows = await tx.$queryRaw<WalletAccountRow[]>`
      UPDATE "WalletAccount"
      SET "currentBalance" = ${nextBalance}, "updatedAt" = NOW()
      WHERE "id" = ${wallet.id}
      RETURNING "id", "customerProfileId", "currency", "currentBalance", "createdAt", "updatedAt"
    `;

    const account = updatedRows[0];
    const transaction = transactionRows[0];

    await tx.auditEvent.create({
      data: {
        actorType: input.createdByType.toLowerCase(),
        actorId: input.createdById || null,
        eventType: input.direction === "CREDIT" ? "WALLET_CREDIT" : "WALLET_DEBIT",
        entityType: "WalletTransaction",
        entityId: transaction.id,
        payload: {
          customerProfileId: input.customerProfileId,
          walletAccountId: wallet.id,
          transactionType: input.transactionType,
          sourceType: input.sourceType,
          sourceId: input.sourceId || null,
          amount: input.amount,
          currency,
          balanceAfter: account.currentBalance,
          reason: input.reason || null,
          adminNote: input.adminNote || null,
        } as Prisma.InputJsonValue,
      },
    });

    return { account, transaction };
  });
}
