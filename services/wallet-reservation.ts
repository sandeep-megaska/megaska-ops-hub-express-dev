import { randomUUID } from "crypto";
import { prisma } from "./db/prisma";
import { getOrCreateWalletAccount } from "./wallet";
import { attachCartDiscountCodes, getCartPricingSnapshot, updateCartAttributes } from "./shopify/storefront";
import { createWalletReservationDiscountCode, disableWalletReservationDiscountCode } from "./shopify/admin";

export type WalletReservationStatus = "ACTIVE" | "CONSUMED" | "RELEASED" | "EXPIRED";

export type CreateWalletReservationInput = {
  shopId: string;
  customerProfileId: string;
  cartId: string;
  sourceFlow?: "CHECKOUT" | "BUY_NOW";
  amountMinor: number;
  currency?: string;
  sessionReference?: string | null;
};

export async function expireWalletReservations(now = new Date()) {
  await prisma.$executeRaw`
    UPDATE "WalletReservation"
    SET "status" = 'EXPIRED'::"WalletReservationStatus", "updatedAt" = NOW()
    WHERE "status" = 'ACTIVE'::"WalletReservationStatus" AND "expiresAt" <= ${now}
  `;
}

async function sanitizeStaleActiveWalletReservations(
  customerProfileId: string,
  db: Pick<typeof prisma, "$queryRaw" | "$executeRaw"> = prisma
) {
  const activeReservations = await db.$queryRaw<Array<{
    id: string;
    status: WalletReservationStatus;
    reservedAmount: number | null;
    shopifyDiscountId: string | null;
    discountCode: string | null;
  }>>`
    SELECT "id", "status", "reservedAmount", "shopifyDiscountId", "discountCode"
    FROM "WalletReservation"
    WHERE "customerProfileId" = ${customerProfileId}
      AND "status" = 'ACTIVE'::"WalletReservationStatus"
      AND "expiresAt" > NOW()
  `;

  console.log("[WALLET RESERVATION] sanitize stale active start", {
    customerProfileId,
    activeReservationCount: activeReservations.length,
  });

  let sanitizedCount = 0;

  for (const reservation of activeReservations) {
    const amountMinor = reservation.reservedAmount;
    const hasDiscountNodeId = Boolean(String(reservation.shopifyDiscountId || "").trim());
    const hasCode = Boolean(String(reservation.discountCode || "").trim());
    const isInvalid = amountMinor == null || amountMinor <= 0 || !hasDiscountNodeId || !hasCode;

    if (!isInvalid) {
      continue;
    }

    console.log("[WALLET RESERVATION] sanitize stale active item", {
      reservationId: reservation.id,
      previousStatus: reservation.status,
      amountMinor,
      hasDiscountNodeId,
      hasCode,
    });

    await db.$executeRaw`
      UPDATE "WalletReservation"
      SET "status" = 'RELEASED'::"WalletReservationStatus",
          "releaseReason" = ${"invalid-incomplete-active"},
          "updatedAt" = NOW()
      WHERE "id" = ${reservation.id}
    `;

    sanitizedCount += 1;
  }

  console.log("[WALLET RESERVATION] sanitize stale active success", {
    customerProfileId,
    sanitizedCount,
  });
}

async function cleanupExistingActiveWalletReservations(customerProfileId: string) {
  const activeReservations = await prisma.$queryRaw<Array<{
    id: string;
    status: WalletReservationStatus;
    shopifyDiscountId: string | null;
  }>>`
    SELECT "id", "status", "shopifyDiscountId"
    FROM "WalletReservation"
    WHERE "customerProfileId" = ${customerProfileId}
      AND "status" = 'ACTIVE'::"WalletReservationStatus"
      AND "expiresAt" > NOW()
    ORDER BY "createdAt" DESC
  `;

  console.log("[WALLET RESERVATION] cleanup existing active start", {
    customerProfileId,
    activeReservationCount: activeReservations.length,
  });

  for (const reservation of activeReservations) {
    const discountNodeId = String(reservation.shopifyDiscountId || "").trim() || null;
    const hadDiscountNodeId = Boolean(discountNodeId);

    console.log("[WALLET RESERVATION] cleanup existing active item", {
      customerProfileId,
      reservationId: reservation.id,
      previousStatus: reservation.status,
      discountNodeId,
      hadDiscountNodeId,
    });

    try {
      if (discountNodeId) {
        await disableWalletReservationDiscountCode(discountNodeId);
      }

      await prisma.$executeRaw`
        UPDATE "WalletReservation"
        SET "status" = 'RELEASED'::"WalletReservationStatus",
            "releaseReason" = ${"superseded-by-new-apply"},
            "updatedAt" = NOW()
        WHERE "id" = ${reservation.id}
      `;

      console.log("[WALLET RESERVATION] cleanup existing active success", {
        customerProfileId,
        reservationId: reservation.id,
        previousStatus: reservation.status,
        discountNodeId,
        hadDiscountNodeId,
      });
    } catch (error) {
      console.error("[WALLET RESERVATION] cleanup existing active failed", {
        customerProfileId,
        reservationId: reservation.id,
        previousStatus: reservation.status,
        discountNodeId,
        hadDiscountNodeId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

export async function createWalletReservation(input: CreateWalletReservationInput) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("Wallet amount must be a positive amount");
  }

  // Tenant isolation: every reservation is bound to the acting shop.
  const shopId = String(input.shopId || "").trim();
  if (!shopId) {
    throw new Error("shopId is required to create a wallet reservation");
  }

  const currency = String(input.currency || "INR").trim() || "INR";
  const sourceFlow = input.sourceFlow || "CHECKOUT";
  let reservationId: string | null = null;
  console.log("[WALLET RESERVATION] create start", {
    customerProfileId: input.customerProfileId,
    amountMinor: input.amountMinor,
    status: "ACTIVE",
    currency,
  });
  await expireWalletReservations();
  await sanitizeStaleActiveWalletReservations(input.customerProfileId);
  await cleanupExistingActiveWalletReservations(input.customerProfileId);

  const pricing = await getCartPricingSnapshot(input.cartId);
  if (!pricing.ok) {
    throw new Error(pricing.error || "Unable to load cart pricing");
  }

  if (pricing.subtotalAmount <= 0) {
    throw new Error("Cart subtotal is zero");
  }

  const redeemableCap = Math.min(pricing.subtotalAmount, pricing.totalAmount > 0 ? pricing.totalAmount : pricing.subtotalAmount);
  if (input.amountMinor > redeemableCap) {
    throw new Error("Wallet amount cannot exceed current order subtotal");
  }

  try {
    const reservation = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "WalletReservation"
      SET "status" = 'EXPIRED'::"WalletReservationStatus", "updatedAt" = NOW()
      WHERE "status" = 'ACTIVE'::"WalletReservationStatus" AND "expiresAt" <= NOW()
    `;

    await sanitizeStaleActiveWalletReservations(input.customerProfileId, tx);

    const wallet = await getOrCreateWalletAccount(input.customerProfileId, currency, { shopId });

    const wallets = await tx.$queryRaw<Array<{ currentBalance: number }>>`
      SELECT "currentBalance"
      FROM "WalletAccount"
      WHERE "id" = ${wallet.id}
      FOR UPDATE
    `;

    const lockedWallet = wallets[0];
    if (!lockedWallet) {
      throw new Error("Wallet account not found");
    }

    const existingActiveReservations = await tx.$queryRaw<Array<{
      id: string;
      status: WalletReservationStatus;
      shopifyDiscountId: string | null;
    }>>`
      SELECT "id", "status", "shopifyDiscountId"
      FROM "WalletReservation"
      WHERE "customerProfileId" = ${input.customerProfileId}
        AND "walletAccountId" = ${wallet.id}
        AND "currency" = ${currency}
        AND "status" = 'ACTIVE'::"WalletReservationStatus"
      FOR UPDATE
    `;

    console.log("[WALLET RESERVATION] cleanup existing active start", {
      customerProfileId: input.customerProfileId,
      activeReservationCount: existingActiveReservations.length,
    });

    let cleanedReservationCount = 0;
    for (const existingReservation of existingActiveReservations) {
      try {
        if (existingReservation.shopifyDiscountId) {
          await disableWalletReservationDiscountCode(existingReservation.shopifyDiscountId);
        }

        await tx.$executeRaw`
          UPDATE "WalletReservation"
          SET "status" = 'RELEASED'::"WalletReservationStatus",
              "releaseReason" = ${"superseded-by-new-reservation"},
              "updatedAt" = NOW()
          WHERE "id" = ${existingReservation.id}
        `;

        cleanedReservationCount += 1;

        console.log("[WALLET RESERVATION] cleanup existing active item", {
          customerProfileId: input.customerProfileId,
          reservationId: existingReservation.id,
          previousStatus: existingReservation.status,
          hadDiscountNodeId: Boolean(existingReservation.shopifyDiscountId),
        });
      } catch (error) {
        console.error("[WALLET RESERVATION] cleanup existing active failed", {
          customerProfileId: input.customerProfileId,
          reservationId: existingReservation.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      }
    }

    console.log("[WALLET RESERVATION] cleanup existing active success", {
      customerProfileId: input.customerProfileId,
      cleanedReservationCount,
    });

    const activeReservations = await tx.$queryRaw<Array<{ total: number }>>`
      SELECT COALESCE(SUM("reservedAmount"), 0)::int AS total
      FROM "WalletReservation"
      WHERE "walletAccountId" = ${wallet.id}
        AND "currency" = ${currency}
        AND "status" = 'ACTIVE'::"WalletReservationStatus"
        AND "expiresAt" > NOW()
    `;

    const alreadyReserved = Number(activeReservations[0]?.total || 0);
    const available = lockedWallet.currentBalance - alreadyReserved;
    if (available < input.amountMinor) {
      throw new Error("Insufficient available wallet balance");
    }

    const rowId = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const rows = await tx.$queryRaw<Array<{ id: string; expiresAt: Date; walletAccountId: string }>>`
      INSERT INTO "WalletReservation" (
        "id", "shopId", "walletAccountId", "customerProfileId", "reservedAmount", "currency", "status",
        "sourceFlow", "cartReference", "sessionReference", "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        ${rowId}, ${shopId}, ${wallet.id}, ${input.customerProfileId}, ${input.amountMinor}, ${currency}, 'ACTIVE'::"WalletReservationStatus",
        ${sourceFlow}::"WalletReservationSourceFlow", ${input.cartId}, ${input.sessionReference || null}, ${expiresAt}, NOW(), NOW()
      )
      RETURNING "id", "expiresAt", "walletAccountId"
    `;

    if (!rows[0]) {
      throw new Error("Failed to create wallet reservation");
    }

      return { id: rows[0].id, walletAccountId: rows[0].walletAccountId, expiresAt: rows[0].expiresAt };
    });
    reservationId = reservation.id;

    let discount: { code: string; discountNodeId: string };
    try {
      discount = await createWalletReservationDiscountCode({
        reservationId: reservation.id,
        amountMinor: input.amountMinor,
        currency,
        customerProfileId: input.customerProfileId,
        endsAt: reservation.expiresAt,
      });
    } catch (error) {
      await prisma.$executeRaw`
        UPDATE "WalletReservation"
        SET "status" = 'RELEASED'::"WalletReservationStatus",
            "releaseReason" = ${"shopify-discount-create-failed"},
            "updatedAt" = NOW()
        WHERE "id" = ${reservation.id}
      `;
      console.error("[WALLET RESERVATION] create failed", {
        customerProfileId: input.customerProfileId,
        reservationId: reservation.id,
        amountMinor: input.amountMinor,
        status: "RELEASED",
        currency,
      });
      throw error;
    }

    await prisma.$executeRaw`
      UPDATE "WalletReservation"
      SET "discountCode" = ${discount.code}, "shopifyDiscountId" = ${discount.discountNodeId}, "updatedAt" = NOW()
      WHERE "id" = ${reservation.id}
    `;

    await updateCartAttributes({
      cartId: input.cartId,
      attributes: [
        { key: "megaska_wallet_reservation_id", value: reservation.id },
        { key: "megaska_wallet_discount_code", value: discount.code },
        { key: "megaska_wallet_reserved_amount", value: String(input.amountMinor) },
      ],
    });

    await attachCartDiscountCodes({
      cartId: input.cartId,
      discountCodes: [discount.code],
    });

    console.log("[WALLET RESERVATION] create success", {
      customerProfileId: input.customerProfileId,
      reservationId: reservation.id,
      amountMinor: input.amountMinor,
      status: "ACTIVE",
      currency,
    });

    return {
      reservationId: reservation.id,
      discountCode: discount.code,
      discountNodeId: discount.discountNodeId,
      expiresAt: reservation.expiresAt,
      amountMinor: input.amountMinor,
      currency,
      cartPricing: pricing,
    };
  } catch (error) {
    console.error("[WALLET RESERVATION] create failed", {
      customerProfileId: input.customerProfileId,
      reservationId,
      amountMinor: input.amountMinor,
      status: reservationId ? "ACTIVE_OR_RELEASED" : null,
      currency,
    });
    throw error;
  }
}

export async function consumeWalletReservationOnOrder(input: {
  reservationId?: string | null;
  discountCode?: string | null;
  shopifyOrderId: string;
  orderNumber?: string | null;
  customerProfileId?: string | null;
}) {
  await expireWalletReservations();

  const reservationId = String(input.reservationId || "").trim();
  const discountCode = String(input.discountCode || "").trim();
  if (!reservationId && !discountCode) {
    console.log("[WALLET WEBHOOK] idempotent skip", {
      orderId: input.shopifyOrderId,
      reservationId: null,
      reason: "missing-reservation-reference",
    });
    return { ok: true, skipped: true, reason: "missing-reservation-reference" };
  }

  try {
    return await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      id: string;
      walletAccountId: string;
      customerProfileId: string;
      reservedAmount: number;
      currency: string;
      status: WalletReservationStatus;
      discountCode: string | null;
      orderNumber: string | null;
      shopifyOrderId: string | null;
      shopifyDiscountId: string | null;
    }>>`
      SELECT "id", "walletAccountId", "customerProfileId", "reservedAmount", "currency", "status", "discountCode", "orderNumber", "shopifyOrderId", "shopifyDiscountId"
      FROM "WalletReservation"
      WHERE (
        (${reservationId} <> '' AND "id" = ${reservationId})
        OR (${discountCode} <> '' AND "discountCode" = ${discountCode})
      )
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE
    `;

    const reservation = rows[0];
    if (!reservation) {
      console.log("[WALLET WEBHOOK] idempotent skip", {
        orderId: input.shopifyOrderId,
        reservationId: null,
        reason: "reservation-not-found",
      });
      return { ok: true, skipped: true, reason: "reservation-not-found" };
    }

    console.log("[WALLET WEBHOOK] reservation matched", {
      orderId: input.shopifyOrderId,
      reservationId: reservation.id,
      customerProfileId: reservation.customerProfileId,
      amountMinor: reservation.reservedAmount,
    });

    if (input.customerProfileId && reservation.customerProfileId !== input.customerProfileId) {
      console.log("[WALLET WEBHOOK] idempotent skip", {
        orderId: input.shopifyOrderId,
        reservationId: reservation.id,
        reason: "reservation-customer-mismatch",
      });
      return { ok: true, skipped: true, reason: "reservation-customer-mismatch" };
    }

    if (reservation.status === "CONSUMED") {
      console.log("[WALLET WEBHOOK] idempotent skip", {
        orderId: input.shopifyOrderId,
        reservationId: reservation.id,
        reason: "already-consumed",
      });
      return {
        ok: true,
        skipped: true,
        reason: "already-consumed",
        reservationId: reservation.id,
        transactionSourceId: reservation.id,
      };
    }

    if (reservation.status !== "ACTIVE") {
      console.log("[WALLET WEBHOOK] idempotent skip", {
        orderId: input.shopifyOrderId,
        reservationId: reservation.id,
        reason: `reservation-${reservation.status.toLowerCase()}`,
      });
      return { ok: true, skipped: true, reason: `reservation-${reservation.status.toLowerCase()}` };
    }

    await tx.$executeRaw`
      UPDATE "WalletReservation"
      SET "status" = 'CONSUMED'::"WalletReservationStatus",
          "orderNumber" = ${input.orderNumber || null},
          "shopifyOrderId" = ${input.shopifyOrderId},
          "updatedAt" = NOW()
      WHERE "id" = ${reservation.id}
    `;

    const walletRows = await tx.$queryRaw<Array<{ id: string; currentBalance: number }>>`
      SELECT "id", "currentBalance"
      FROM "WalletAccount"
      WHERE "id" = ${reservation.walletAccountId}
      FOR UPDATE
    `;

    const wallet = walletRows[0];
    if (!wallet) {
      throw new Error("Wallet account missing for reservation");
    }

    const balanceAfter = wallet.currentBalance - reservation.reservedAmount;
    if (balanceAfter < 0) {
      throw new Error("Insufficient wallet balance during reservation consumption");
    }

    await tx.$executeRaw`
      UPDATE "WalletAccount"
      SET "currentBalance" = ${balanceAfter}, "updatedAt" = NOW()
      WHERE "id" = ${wallet.id}
    `;

    const transactionRows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "WalletTransaction" (
        "id", "walletAccountId", "customerProfileId", "direction", "transactionType", "amount", "currency",
        "sourceType", "sourceId", "sourceReference", "orderNumber", "reason", "adminNote", "createdByType", "createdById", "createdAt"
      ) VALUES (
        ${randomUUID()}, ${wallet.id}, ${reservation.customerProfileId}, 'DEBIT'::"WalletDirection", 'CHECKOUT_REDEMPTION'::"WalletTransactionType",
        ${reservation.reservedAmount}, ${reservation.currency}, 'WALLET_RESERVATION'::"WalletSourceType", ${reservation.id},
        ${reservation.discountCode || null}, ${input.orderNumber || null}, 'Wallet redeemed at checkout',
        ${`Wallet reservation ${reservation.id} consumed after order placement`}, 'SYSTEM'::"WalletActorType", 'shopify-webhook-orders-create', NOW()
      )
      ON CONFLICT ("sourceType", "sourceId", "transactionType") DO NOTHING
      RETURNING "id"
    `;
    const walletTransactionId = transactionRows[0]?.id || null;

    console.log("[WALLET WEBHOOK] debit success", {
      orderId: input.shopifyOrderId,
      reservationId: reservation.id,
      walletTransactionId,
    });

    console.log("[WALLET WEBHOOK] reservation finalize success", {
      orderId: input.shopifyOrderId,
      reservationId: reservation.id,
      newStatus: "CONSUMED",
    });

    await tx.auditEvent.create({
      data: {
        actorType: "system",
        actorId: "shopify-webhook-orders-create",
        eventType: "WALLET_DEBIT",
        entityType: "WalletReservation",
        entityId: reservation.id,
        payload: {
          customerProfileId: reservation.customerProfileId,
          walletAccountId: wallet.id,
          amount: reservation.reservedAmount,
          currency: reservation.currency,
          sourceId: reservation.id,
          orderNumber: input.orderNumber || null,
          balanceAfter,
        },
      },
    });

    if (reservation.shopifyDiscountId) {
      try {
        await disableWalletReservationDiscountCode(reservation.shopifyDiscountId);
      } catch (error) {
        console.warn("[Wallet Reservation] failed to disable discount", {
          reservationId: reservation.id,
          discountId: reservation.shopifyDiscountId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      ok: true,
      reservationId: reservation.id,
      consumedAmount: reservation.reservedAmount,
      transactionSourceId: reservation.id,
      walletTransactionId,
    };
    });
  } catch (error) {
    console.error("[WALLET WEBHOOK] finalize failed", {
      orderId: input.shopifyOrderId,
      reservationId: reservationId || null,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

export async function releaseWalletReservation(input: { reservationId: string; reason?: string }) {
  const reservationId = String(input.reservationId || "").trim();
  if (!reservationId) throw new Error("reservationId is required");

  const rows = await prisma.$queryRaw<Array<{ id: string; status: WalletReservationStatus; shopifyDiscountId: string | null }>>`
    UPDATE "WalletReservation"
    SET "status" = CASE
      WHEN "status" = 'ACTIVE'::"WalletReservationStatus" THEN 'RELEASED'::"WalletReservationStatus"
      ELSE "status"
    END,
    "releaseReason" = ${String(input.reason || "").trim() || null},
    "updatedAt" = NOW()
    WHERE "id" = ${reservationId}
    RETURNING "id", "status", "shopifyDiscountId"
  `;

  const reservation = rows[0];
  if (!reservation) {
    return { ok: true, skipped: true, reason: "reservation-not-found" };
  }

  if (reservation.shopifyDiscountId) {
    await disableWalletReservationDiscountCode(reservation.shopifyDiscountId);
  }

  return { ok: true, reservationId: reservation.id, status: reservation.status };
}

export async function listWalletReservationsForAdmin(customerProfileId: string) {
  return prisma.$queryRaw<Array<{
    id: string;
    reservedAmount: number;
    currency: string;
    status: WalletReservationStatus;
    discountCode: string | null;
    orderNumber: string | null;
    shopifyOrderId: string | null;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }>>`
    SELECT "id", "reservedAmount", "currency", "status", "discountCode", "orderNumber", "shopifyOrderId", "expiresAt", "createdAt", "updatedAt"
    FROM "WalletReservation"
    WHERE "customerProfileId" = ${customerProfileId}
    ORDER BY "createdAt" DESC
    LIMIT 100
  `;
}
