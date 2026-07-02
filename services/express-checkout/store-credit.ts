import { randomUUID } from "crypto";
import { prisma } from "../db/prisma";

const CURRENCY = "INR";
const RESERVATION_TTL_MS = 15 * 60 * 1000;

export type StoreCreditCheckoutAmounts = {
  availableAmount: number;
  availableAmountPaise: number;
  appliedAmount: number;
  appliedAmountPaise: number;
  remainingPayable: number;
  remainingPayablePaise: number;
  currency: "INR";
  reservationId: string | null;
};

type Params = { shopId: string; customerProfileId: string; checkoutIntentId: string };
type StoreCreditDb = Pick<typeof prisma, "$queryRaw" | "$executeRaw"> & { expressCheckoutIntent: { findFirst(args: unknown): Promise<{ id: string; totalAmountPaise: number } | null> } };
const storeCreditDb = prisma as unknown as StoreCreditDb;

function rupees(paise: number) { return Math.max(0, Math.round(paise)) / 100; }

async function assertIntent(params: Params, db: StoreCreditDb = storeCreditDb) {
  const intent = await db.expressCheckoutIntent.findFirst({ where: { id: params.checkoutIntentId, shopId: params.shopId, customerProfileId: params.customerProfileId } });
  if (!intent) throw new Error("Checkout intent not found");
  return intent;
}

export async function getActiveStoreCreditReservation(params: Params, db: Pick<typeof prisma, "$queryRaw"> = prisma) {
  const rows = await db.$queryRaw<Array<{ id: string; reservedAmount: number }>>`
    SELECT "id", "reservedAmount"
    FROM "WalletReservation"
    WHERE "shopId" = ${params.shopId}
      AND "customerProfileId" = ${params.customerProfileId}
      AND "checkoutReference" = ${params.checkoutIntentId}
      AND "status" = 'ACTIVE'::"WalletReservationStatus"
      AND "expiresAt" > NOW()
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function releaseExpiredStoreCreditReservations(params: { shopId: string; customerProfileId: string }) {
  await prisma.$executeRaw`
    UPDATE "WalletReservation"
    SET "status" = 'EXPIRED'::"WalletReservationStatus", "releaseReason" = COALESCE("releaseReason", 'checkout-store-credit-expired'), "updatedAt" = NOW()
    WHERE "shopId" = ${params.shopId}
      AND "customerProfileId" = ${params.customerProfileId}
      AND "status" = 'ACTIVE'::"WalletReservationStatus"
      AND "expiresAt" <= NOW()
  `;
}

function storeCreditDiagnosticsEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.STORE_CREDIT_DIAGNOSTICS === "true";
}

function logRawOnConflictAttempt(context: { table: string; conflictTarget: string[]; operation: string; shopId?: string; customerProfileId?: string; checkoutIntentId?: string; sourceId?: string | null }) {
  if (!storeCreditDiagnosticsEnabled()) return;
  console.info("[ON CONFLICT DIAGNOSTIC] attempting_raw_on_conflict", context);
}

async function keepSingleActiveCheckoutReservation(params: Params, tx: Pick<typeof prisma, "$queryRaw" | "$executeRaw">) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "WalletReservation"
    WHERE "shopId" = ${params.shopId}
      AND "customerProfileId" = ${params.customerProfileId}
      AND "checkoutReference" = ${params.checkoutIntentId}
      AND "status" = 'ACTIVE'::"WalletReservationStatus"
      AND "expiresAt" > NOW()
    ORDER BY "updatedAt" DESC, "createdAt" DESC
    FOR UPDATE
  `;
  const [keeper, ...duplicates] = rows;
  if (duplicates.length) {
    for (const duplicate of duplicates) {
      await tx.$executeRaw`
        UPDATE "WalletReservation"
        SET "status" = 'RELEASED'::"WalletReservationStatus",
            "releaseReason" = COALESCE("releaseReason", 'duplicate-checkout-store-credit-reservation-released'),
            "updatedAt" = NOW()
        WHERE "id" = ${duplicate.id}
      `;
    }
    console.warn("[STORE CREDIT CHECKOUT] duplicate_active_reservations_released", { ...params, keptReservationId: keeper?.id || null, releasedReservationIds: duplicates.map((row) => row.id) });
  }
  return keeper || null;
}

async function getOrCreateShopScopedWallet(tx: Pick<typeof prisma, "$queryRaw" | "$executeRaw">, shopId: string, customerProfileId: string) {
  const walletId = randomUUID();
  logRawOnConflictAttempt({ table: "WalletAccount", conflictTarget: ["shopId", "customerProfileId", "currency"], operation: "INSERT ... ON CONFLICT DO NOTHING", shopId, customerProfileId });
  await tx.$executeRaw`
    INSERT INTO "WalletAccount" ("id", "shopId", "customerProfileId", "currency", "currentBalance", "createdAt", "updatedAt")
    VALUES (${walletId}, ${shopId}, ${customerProfileId}, ${CURRENCY}, 0, NOW(), NOW())
    ON CONFLICT ("shopId", "customerProfileId", "currency") DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ id: string; currentBalance: number; currency: string }>>`
    SELECT "id", "currentBalance", "currency"
    FROM "WalletAccount"
    WHERE "shopId" = ${shopId} AND "customerProfileId" = ${customerProfileId} AND "currency" = ${CURRENCY}
    LIMIT 1
    FOR UPDATE
  `;
  if (!rows[0]) throw new Error("Store Credit account not found");
  return rows[0];
}

async function amounts(params: Params, db: StoreCreditDb = storeCreditDb): Promise<StoreCreditCheckoutAmounts> {
  const intent = await assertIntent(params, db);
  if (db === storeCreditDb) await releaseExpiredStoreCreditReservations(params);
  const walletRows = await db.$queryRaw<Array<{ id: string; currentBalance: number }>>`
    SELECT "id", "currentBalance"
    FROM "WalletAccount"
    WHERE "shopId" = ${params.shopId} AND "customerProfileId" = ${params.customerProfileId} AND "currency" = ${CURRENCY}
    LIMIT 1
  `;
  const wallet = walletRows[0];
  if (!wallet) return { availableAmount: 0, availableAmountPaise: 0, appliedAmount: 0, appliedAmountPaise: 0, remainingPayable: rupees(intent.totalAmountPaise), remainingPayablePaise: intent.totalAmountPaise, currency: CURRENCY, reservationId: null };
  const reservedRows = await db.$queryRaw<Array<{ total: number }>>`
    SELECT COALESCE(SUM("reservedAmount"), 0)::int AS total
    FROM "WalletReservation"
    WHERE "walletAccountId" = ${wallet.id}
      AND "status" = 'ACTIVE'::"WalletReservationStatus"
      AND "expiresAt" > NOW()
      AND COALESCE("checkoutReference", '') <> ${params.checkoutIntentId}
  `;
  const active = await getActiveStoreCreditReservation(params, db);
  const availablePaise = Math.max(0, Number(wallet.currentBalance || 0) - Number(reservedRows[0]?.total || 0));
  const appliedPaise = Math.min(Number(active?.reservedAmount || 0), availablePaise, Math.max(0, Number(intent.totalAmountPaise || 0)));
  return { availableAmount: rupees(availablePaise), availableAmountPaise: availablePaise, appliedAmount: rupees(appliedPaise), appliedAmountPaise: appliedPaise, remainingPayable: rupees(Math.max(0, Number(intent.totalAmountPaise || 0) - appliedPaise)), remainingPayablePaise: Math.max(0, Number(intent.totalAmountPaise || 0) - appliedPaise), currency: CURRENCY, reservationId: active?.id || null };
}

export async function getAvailableStoreCreditForCheckout(params: Params) {
  const result = await amounts(params);
  console.info("[STORE CREDIT CHECKOUT] store_credit_checkout_available_loaded", { shopId: params.shopId, customerProfileId: params.customerProfileId, checkoutIntentId: params.checkoutIntentId, availableAmountPaise: result.availableAmountPaise, appliedAmountPaise: result.appliedAmountPaise });
  return result;
}

export async function applyStoreCreditToCheckout(params: Params) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${params.shopId}:${params.customerProfileId}:${params.checkoutIntentId}:store_credit`}))`;
    const intent = await assertIntent(params, tx as unknown as StoreCreditDb);
    const wallet = await getOrCreateShopScopedWallet(tx, params.shopId, params.customerProfileId);
    await tx.$executeRaw`
      UPDATE "WalletReservation"
      SET "status" = 'EXPIRED'::"WalletReservationStatus", "releaseReason" = COALESCE("releaseReason", 'checkout-store-credit-expired'), "updatedAt" = NOW()
      WHERE "shopId" = ${params.shopId} AND "customerProfileId" = ${params.customerProfileId} AND "status" = 'ACTIVE'::"WalletReservationStatus" AND "expiresAt" <= NOW()
    `;
    await keepSingleActiveCheckoutReservation(params, tx);
    const reservedRows = await tx.$queryRaw<Array<{ total: number }>>`
      SELECT COALESCE(SUM("reservedAmount"), 0)::int AS total FROM "WalletReservation"
      WHERE "walletAccountId" = ${wallet.id} AND "status" = 'ACTIVE'::"WalletReservationStatus" AND "expiresAt" > NOW() AND COALESCE("checkoutReference", '') <> ${params.checkoutIntentId}
    `;
    const availablePaise = Math.max(0, wallet.currentBalance - Number(reservedRows[0]?.total || 0));
    // TODO(SC-1.11): keep full Store Credit coverage enabled because Shopify draftOrderComplete supports a fully discounted draft in DEV UAT; cap here to total-1 if DEV UAT proves a zero-payable order is unsafe.
    const applicablePaise = Math.min(availablePaise, Math.max(0, Number(intent.totalAmountPaise || 0)));
    if (applicablePaise <= 0) throw new Error("No Megaska Store Credit available");
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
    const existing = await getActiveStoreCreditReservation(params, tx);
    const reservationId = existing?.id || randomUUID();
    if (existing) {
      await tx.$executeRaw`UPDATE "WalletReservation" SET "reservedAmount" = ${applicablePaise}, "expiresAt" = ${expiresAt}, "updatedAt" = NOW() WHERE "id" = ${existing.id}`;
    } else {
      await tx.$executeRaw`
        INSERT INTO "WalletReservation" ("id", "shopId", "walletAccountId", "customerProfileId", "reservedAmount", "currency", "status", "sourceFlow", "checkoutReference", "expiresAt", "createdAt", "updatedAt")
        VALUES (${reservationId}, ${params.shopId}, ${wallet.id}, ${params.customerProfileId}, ${applicablePaise}, ${CURRENCY}, 'ACTIVE'::"WalletReservationStatus", 'CHECKOUT'::"WalletReservationSourceFlow", ${params.checkoutIntentId}, ${expiresAt}, NOW(), NOW())
      `;
    }
    console.info("[STORE CREDIT CHECKOUT] store_credit_checkout_applied", { ...params, reservationId, appliedAmountPaise: applicablePaise });
    return { availableAmount: rupees(availablePaise), availableAmountPaise: availablePaise, appliedAmount: rupees(applicablePaise), appliedAmountPaise: applicablePaise, remainingPayable: rupees(Math.max(0, intent.totalAmountPaise - applicablePaise)), remainingPayablePaise: Math.max(0, intent.totalAmountPaise - applicablePaise), currency: CURRENCY, reservationId };
  });
}

export async function releaseStoreCreditReservation(params: Params & { reason?: string }) {
  const released = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${params.shopId}:${params.customerProfileId}:${params.checkoutIntentId}:store_credit`}))`;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "WalletReservation"
      SET "status" = 'RELEASED'::"WalletReservationStatus", "releaseReason" = ${params.reason || "checkout-store-credit-released"}, "updatedAt" = NOW()
      WHERE "shopId" = ${params.shopId} AND "customerProfileId" = ${params.customerProfileId} AND "checkoutReference" = ${params.checkoutIntentId} AND "status" = 'ACTIVE'::"WalletReservationStatus"
      RETURNING "id"
    `;
    return rows.length > 0;
  });
  const result = await amounts(params);
  console.info("[STORE CREDIT CHECKOUT] store_credit_checkout_released", { ...params, released });
  return { ...result, released };
}

export async function consumeStoreCreditReservationForOrder(params: Params & { shopifyOrderId: string; orderNumber?: string | null }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${params.shopId}:${params.customerProfileId}:${params.checkoutIntentId}:store_credit`}))`;
    await keepSingleActiveCheckoutReservation(params, tx);
    const rows = await tx.$queryRaw<Array<{ id: string; walletAccountId: string; customerProfileId: string; reservedAmount: number; currency: string; status: string }>>`
      SELECT "id", "walletAccountId", "customerProfileId", "reservedAmount", "currency", "status"
      FROM "WalletReservation"
      WHERE "shopId" = ${params.shopId} AND "customerProfileId" = ${params.customerProfileId} AND "checkoutReference" = ${params.checkoutIntentId}
      ORDER BY CASE WHEN "status" = 'ACTIVE'::"WalletReservationStatus" THEN 0 WHEN "status" = 'CONSUMED'::"WalletReservationStatus" THEN 1 ELSE 2 END, "updatedAt" DESC, "createdAt" DESC
      LIMIT 1 FOR UPDATE
    `;
    const reservation = rows[0];
    if (!reservation || reservation.status === "RELEASED" || reservation.status === "EXPIRED") return { ok: true, skipped: true, reason: "no-active-reservation" };
    if (reservation.status === "CONSUMED") { console.info("[STORE CREDIT CHECKOUT] store_credit_checkout_consume_skipped_idempotent", { ...params, reservationId: reservation.id }); return { ok: true, skipped: true, reason: "already-consumed", reservationId: reservation.id }; }
    const walletRows = await tx.$queryRaw<Array<{ id: string; currentBalance: number }>>`SELECT "id", "currentBalance" FROM "WalletAccount" WHERE "id" = ${reservation.walletAccountId} FOR UPDATE`;
    const wallet = walletRows[0];
    if (!wallet) throw new Error("Store Credit account missing");
    const nextBalance = wallet.currentBalance - reservation.reservedAmount;
    if (nextBalance < 0) throw new Error("Insufficient Store Credit balance during consumption");
    await tx.$executeRaw`UPDATE "WalletAccount" SET "currentBalance" = ${nextBalance}, "updatedAt" = NOW() WHERE "id" = ${wallet.id}`;
    await tx.$executeRaw`UPDATE "WalletReservation" SET "status" = 'CONSUMED'::"WalletReservationStatus", "shopifyOrderId" = ${params.shopifyOrderId}, "orderNumber" = ${params.orderNumber || null}, "updatedAt" = NOW() WHERE "id" = ${reservation.id}`;
    logRawOnConflictAttempt({ table: "WalletTransaction", conflictTarget: ["sourceType", "sourceId", "transactionType"], operation: "INSERT ... ON CONFLICT DO NOTHING RETURNING id", shopId: params.shopId, customerProfileId: params.customerProfileId, checkoutIntentId: params.checkoutIntentId, sourceId: reservation.id });
    let transactionRows: Array<{ id: string }>;
    try {
      transactionRows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "WalletTransaction" ("id", "shopId", "walletAccountId", "customerProfileId", "direction", "transactionType", "amount", "currency", "sourceType", "sourceId", "sourceReference", "orderNumber", "reason", "adminNote", "createdByType", "createdById", "createdAt")
        VALUES (${randomUUID()}, ${params.shopId}, ${wallet.id}, ${params.customerProfileId}, 'DEBIT'::"WalletDirection", 'CHECKOUT_REDEMPTION'::"WalletTransactionType", ${reservation.reservedAmount}, ${reservation.currency}, 'WALLET_RESERVATION'::"WalletSourceType", ${reservation.id}, ${params.checkoutIntentId}, ${params.orderNumber || null}, 'Megaska Store Credit redeemed at checkout', ${`Store Credit reservation ${reservation.id} consumed after Shopify order creation`}, 'SYSTEM'::"WalletActorType", 'express-checkout-store-credit', NOW())
        ON CONFLICT ("sourceType", "sourceId", "transactionType") DO NOTHING RETURNING "id"
      `;
    } catch (error) {
      console.error("[ON CONFLICT DIAGNOSTIC] raw_on_conflict_failed", { table: "WalletTransaction", conflictTarget: ["sourceType", "sourceId", "transactionType"], operation: "INSERT ... ON CONFLICT DO NOTHING RETURNING id", shopId: params.shopId, customerProfileId: params.customerProfileId, checkoutIntentId: params.checkoutIntentId, sourceId: reservation.id, errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    console.info("[STORE CREDIT CHECKOUT] store_credit_checkout_consumed", { ...params, reservationId: reservation.id, consumedAmountPaise: reservation.reservedAmount, walletTransactionId: transactionRows[0]?.id || null });
    return { ok: true, reservationId: reservation.id, consumedAmountPaise: reservation.reservedAmount, walletTransactionId: transactionRows[0]?.id || null };
  });
}
