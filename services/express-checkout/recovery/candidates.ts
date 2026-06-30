import { prisma } from "../../db/prisma";
import type { CheckoutRecoveryType } from "./tokens";

const RECOVERY_CANDIDATE_AGE_MS = 30 * 60 * 1000;

export type CheckoutRecoveryCandidate = {
  shopId: string;
  checkoutIntentId: string;
  customerProfileId: string | null;
  recoveryType: CheckoutRecoveryType;
  expiresAt: Date | null;
  lastTransitionAt: Date | null;
  paymentPendingAt: Date | null;
  customerPhone: string | null;
};

type RecoveryCandidateRow = {
  shopId: string;
  checkoutIntentId: string;
  customerProfileId: string | null;
  recoveryType: CheckoutRecoveryType;
  expiresAt: Date | null;
  lastTransitionAt: Date | null;
  paymentPendingAt: Date | null;
  customerPhone: string | null;
};

type RecoveryCandidateDb = {
  $queryRaw<T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

async function hasCheckoutIntentColumn(
  db: RecoveryCandidateDb,
  columnName: string,
) {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'ExpressCheckoutIntent'
        AND column_name = ${columnName}
    ) AS "exists"
  `;

  return Boolean(rows[0]?.exists);
}

function mapCandidateRows(rows: RecoveryCandidateRow[]) {
  return rows.map((row) => ({
    shopId: row.shopId,
    checkoutIntentId: row.checkoutIntentId,
    customerProfileId: row.customerProfileId,
    recoveryType: row.recoveryType,
    expiresAt: row.expiresAt,
    lastTransitionAt: row.lastTransitionAt,
    paymentPendingAt: row.paymentPendingAt,
    customerPhone: row.customerPhone,
  }));
}

export async function findCheckoutRecoveryCandidates(
  now = new Date(),
): Promise<CheckoutRecoveryCandidate[]> {
  const cutoff = new Date(now.getTime() - RECOVERY_CANDIDATE_AGE_MS);
  const db = prisma as unknown as RecoveryCandidateDb;
  const hasCompletedAt = await hasCheckoutIntentColumn(db, "completedAt");
  const hasLastTransitionAt = await hasCheckoutIntentColumn(
    db,
    "lastTransitionAt",
  );
  const lastTransitionExpression = hasLastTransitionAt
    ? 'i."lastTransitionAt"'
    : 'i."updatedAt"';
  const completedFilter = hasCompletedAt ? 'AND i."completedAt" IS NULL' : "";

  const rows = await db.$queryRawUnsafe<RecoveryCandidateRow[]>(
    `
      SELECT
        i."shopId",
        i."id" AS "checkoutIntentId",
        i."customerProfileId",
        'CHECKOUT_ABANDONMENT'::"CheckoutRecoveryType" AS "recoveryType",
        i."expiresAt",
        ${lastTransitionExpression} AS "lastTransitionAt",
        NULL::timestamp AS "paymentPendingAt",
        COALESCE(NULLIF(i."phoneSnapshot", ''), NULLIF(c."phoneE164", '')) AS "customerPhone"
      FROM "ExpressCheckoutIntent" i
      LEFT JOIN "CustomerProfile" c ON c."id" = i."customerProfileId" AND c."shopId" = i."shopId"
      WHERE i."status" IN ('SESSION_VERIFIED'::"ExpressCheckoutIntentStatus", 'ADDRESS_COMPLETED'::"ExpressCheckoutIntentStatus", 'DELIVERY_VALIDATED'::"ExpressCheckoutIntentStatus", 'PAYMENT_SELECTED'::"ExpressCheckoutIntentStatus")
        ${completedFilter}
        AND (i."expiresAt" IS NULL OR i."expiresAt" > $1)
        AND ${lastTransitionExpression} < $2
        AND COALESCE(NULLIF(i."phoneSnapshot", ''), NULLIF(c."phoneE164", '')) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "CheckoutRecoveryToken" t
          WHERE t."shopId" = i."shopId"
            AND t."checkoutIntentId" = i."id"
            AND t."recoveryType" = 'CHECKOUT_ABANDONMENT'::"CheckoutRecoveryType"
            AND t."status" = 'ACTIVE'::"CheckoutRecoveryTokenStatus"
            AND t."expiresAt" > $1
        )
      ORDER BY ${lastTransitionExpression} ASC
    `,
    now,
    cutoff,
  );

  const candidates = mapCandidateRows(rows);
  console.info("[CHECKOUT RECOVERY] checkout_recovery_candidates_found", {
    count: candidates.length,
  });
  return candidates;
}

export async function findPaymentRecoveryCandidates(
  now = new Date(),
): Promise<CheckoutRecoveryCandidate[]> {
  const cutoff = new Date(now.getTime() - RECOVERY_CANDIDATE_AGE_MS);
  const db = prisma as unknown as RecoveryCandidateDb;
  const hasCompletedAt = await hasCheckoutIntentColumn(db, "completedAt");
  const hasPaymentPendingAt = await hasCheckoutIntentColumn(
    db,
    "paymentPendingAt",
  );
  const hasLastTransitionAt = await hasCheckoutIntentColumn(
    db,
    "lastTransitionAt",
  );
  const completedFilter = hasCompletedAt ? 'AND i."completedAt" IS NULL' : "";
  const pendingAgeFilter = hasPaymentPendingAt
    ? 'AND i."paymentPendingAt" < $2'
    : "";
  const lastTransitionSelect = hasLastTransitionAt
    ? 'i."lastTransitionAt"'
    : 'i."updatedAt"';
  const paymentPendingSelect = hasPaymentPendingAt
    ? 'i."paymentPendingAt"'
    : "NULL::timestamp";
  const orderExpression = hasPaymentPendingAt
    ? 'i."paymentPendingAt"'
    : lastTransitionSelect;

  const rows = await db.$queryRawUnsafe<RecoveryCandidateRow[]>(
    `
      SELECT
        i."shopId",
        i."id" AS "checkoutIntentId",
        i."customerProfileId",
        'PAYMENT_ABANDONMENT'::"CheckoutRecoveryType" AS "recoveryType",
        i."expiresAt",
        ${lastTransitionSelect} AS "lastTransitionAt",
        ${paymentPendingSelect} AS "paymentPendingAt",
        COALESCE(NULLIF(i."phoneSnapshot", ''), NULLIF(c."phoneE164", '')) AS "customerPhone"
      FROM "ExpressCheckoutIntent" i
      LEFT JOIN "CustomerProfile" c ON c."id" = i."customerProfileId" AND c."shopId" = i."shopId"
      WHERE i."selectedPaymentMethod" = 'PREPAID'::"ExpressCheckoutPaymentMethod"
        AND i."status" IN ('PAYMENT_PENDING'::"ExpressCheckoutIntentStatus", 'PAYMENT_FAILED'::"ExpressCheckoutIntentStatus", 'PAYMENT_CANCELLED'::"ExpressCheckoutIntentStatus", 'ABANDONED'::"ExpressCheckoutIntentStatus")
        ${completedFilter}
        AND (i."expiresAt" IS NULL OR i."expiresAt" > $1)
        ${pendingAgeFilter}
        AND COALESCE(NULLIF(i."phoneSnapshot", ''), NULLIF(c."phoneE164", '')) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "CheckoutRecoveryToken" t
          WHERE t."shopId" = i."shopId"
            AND t."checkoutIntentId" = i."id"
            AND t."recoveryType" = 'PAYMENT_ABANDONMENT'::"CheckoutRecoveryType"
            AND t."status" = 'ACTIVE'::"CheckoutRecoveryTokenStatus"
            AND t."expiresAt" > $1
        )
      ORDER BY ${orderExpression} ASC
    `,
    now,
    cutoff,
  );

  const candidates = mapCandidateRows(rows);
  console.info("[CHECKOUT RECOVERY] payment_recovery_candidates_found", {
    count: candidates.length,
  });
  return candidates;
}
