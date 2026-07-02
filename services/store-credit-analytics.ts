import { prisma } from "./db/prisma";

export type StoreCreditAnalyticsRow = {
  shopId: string;
  currency: string;
  outstandingLiability: number;
  reservedStoreCredit: number;
  issuedLast30Days: number;
  issuedCodRefundCreditLast30Days: number;
  issuedManualCreditLast30Days: number;
  issuedGoodwillCreditLast30Days: number;
  issuedAdjustmentLast30Days: number;
  redeemedLast30Days: number;
  netMovementLast30Days: number;
  refundsSettledAsStoreCredit: number;
};

type AnalyticsBaseRow = {
  shopId: string;
  currency: string;
  outstandingLiability: number;
};

type ReservedRow = {
  shopId: string;
  currency: string;
  reservedStoreCredit: number;
};

type IssuedRow = {
  shopId: string;
  currency: string;
  issuedLast30Days: number;
  issuedCodRefundCreditLast30Days: number;
  issuedManualCreditLast30Days: number;
  issuedGoodwillCreditLast30Days: number;
  issuedAdjustmentLast30Days: number;
};

type RedeemedRow = {
  shopId: string;
  currency: string;
  redeemedLast30Days: number;
};

type RefundSettlementRow = {
  shopId: string;
  currency: string;
  refundsSettledAsStoreCredit: number;
};

function analyticsKey(row: { shopId: string; currency: string }) {
  return `${row.shopId}:${row.currency}`;
}

function getOrCreateRow(
  rowsByKey: Map<string, StoreCreditAnalyticsRow>,
  identity: { shopId: string; currency: string },
): StoreCreditAnalyticsRow {
  const key = analyticsKey(identity);
  const existing = rowsByKey.get(key);
  if (existing) return existing;

  const row: StoreCreditAnalyticsRow = {
    shopId: identity.shopId,
    currency: identity.currency,
    outstandingLiability: 0,
    reservedStoreCredit: 0,
    issuedLast30Days: 0,
    issuedCodRefundCreditLast30Days: 0,
    issuedManualCreditLast30Days: 0,
    issuedGoodwillCreditLast30Days: 0,
    issuedAdjustmentLast30Days: 0,
    redeemedLast30Days: 0,
    netMovementLast30Days: 0,
    refundsSettledAsStoreCredit: 0,
  };
  rowsByKey.set(key, row);
  return row;
}

export async function getStoreCreditAnalytics(now = new Date()): Promise<StoreCreditAnalyticsRow[]> {
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [baseRows, reservedRows, issuedRows, redeemedRows, refundSettlementRows] = await Promise.all([
    prisma.$queryRaw<AnalyticsBaseRow[]>`
      SELECT "shopId", "currency", COALESCE(SUM("currentBalance"), 0)::int AS "outstandingLiability"
      FROM "WalletAccount"
      GROUP BY "shopId", "currency"
    `,
    prisma.$queryRaw<ReservedRow[]>`
      SELECT COALESCE(wr."shopId", wa."shopId") AS "shopId", wr."currency", COALESCE(SUM(wr."reservedAmount"), 0)::int AS "reservedStoreCredit"
      FROM "WalletReservation" wr
      JOIN "WalletAccount" wa ON wa."id" = wr."walletAccountId"
      WHERE wr."status" = 'ACTIVE'::"WalletReservationStatus"
        AND wr."expiresAt" > ${now}
      GROUP BY COALESCE(wr."shopId", wa."shopId"), wr."currency"
    `,
    prisma.$queryRaw<IssuedRow[]>`
      SELECT "shopId", "currency",
        COALESCE(SUM("amount"), 0)::int AS "issuedLast30Days",
        COALESCE(SUM(CASE WHEN "transactionType" = 'COD_REFUND_CREDIT'::"WalletTransactionType" THEN "amount" ELSE 0 END), 0)::int AS "issuedCodRefundCreditLast30Days",
        COALESCE(SUM(CASE WHEN "transactionType" = 'MANUAL_CREDIT'::"WalletTransactionType" THEN "amount" ELSE 0 END), 0)::int AS "issuedManualCreditLast30Days",
        COALESCE(SUM(CASE WHEN "transactionType" = 'GOODWILL_CREDIT'::"WalletTransactionType" THEN "amount" ELSE 0 END), 0)::int AS "issuedGoodwillCreditLast30Days",
        COALESCE(SUM(CASE WHEN "transactionType" = 'ADJUSTMENT'::"WalletTransactionType" THEN "amount" ELSE 0 END), 0)::int AS "issuedAdjustmentLast30Days"
      FROM "WalletTransaction"
      WHERE "direction" = 'CREDIT'::"WalletDirection"
        AND "createdAt" >= ${windowStart}
        AND "createdAt" <= ${now}
      GROUP BY "shopId", "currency"
    `,
    prisma.$queryRaw<RedeemedRow[]>`
      SELECT "shopId", "currency", COALESCE(SUM("amount"), 0)::int AS "redeemedLast30Days"
      FROM "WalletTransaction"
      WHERE "transactionType" = 'CHECKOUT_REDEMPTION'::"WalletTransactionType"
        AND "createdAt" >= ${windowStart}
        AND "createdAt" <= ${now}
      GROUP BY "shopId", "currency"
    `,
    prisma.$queryRaw<RefundSettlementRow[]>`
      SELECT rr."shopId", rr."currency", COALESCE(SUM(rr."amount"), 0)::int AS "refundsSettledAsStoreCredit"
      FROM "RefundRequest" rr
      WHERE rr."walletTransactionId" IS NOT NULL
        AND rr."createdAt" >= ${windowStart}
        AND rr."createdAt" <= ${now}
      GROUP BY rr."shopId", rr."currency"
    `,
  ]);

  const rowsByKey = new Map<string, StoreCreditAnalyticsRow>();

  for (const baseRow of baseRows) {
    getOrCreateRow(rowsByKey, baseRow).outstandingLiability = baseRow.outstandingLiability;
  }

  for (const reservedRow of reservedRows) {
    getOrCreateRow(rowsByKey, reservedRow).reservedStoreCredit = reservedRow.reservedStoreCredit;
  }

  for (const issuedRow of issuedRows) {
    const row = getOrCreateRow(rowsByKey, issuedRow);
    row.issuedLast30Days = issuedRow.issuedLast30Days;
    row.issuedCodRefundCreditLast30Days = issuedRow.issuedCodRefundCreditLast30Days;
    row.issuedManualCreditLast30Days = issuedRow.issuedManualCreditLast30Days;
    row.issuedGoodwillCreditLast30Days = issuedRow.issuedGoodwillCreditLast30Days;
    row.issuedAdjustmentLast30Days = issuedRow.issuedAdjustmentLast30Days;
  }

  for (const redeemedRow of redeemedRows) {
    getOrCreateRow(rowsByKey, redeemedRow).redeemedLast30Days = redeemedRow.redeemedLast30Days;
  }

  for (const refundSettlementRow of refundSettlementRows) {
    getOrCreateRow(rowsByKey, refundSettlementRow).refundsSettledAsStoreCredit = refundSettlementRow.refundsSettledAsStoreCredit;
  }

  return Array.from(rowsByKey.values())
    .map((row) => ({
      ...row,
      netMovementLast30Days: row.issuedLast30Days - row.redeemedLast30Days,
    }))
    .sort((a, b) => a.shopId.localeCompare(b.shopId) || a.currency.localeCompare(b.currency));
}
