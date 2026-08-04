// Reconciles a customer's store-credit LEDGER against their Shopify gift-card balance
// after an order. The card is spent natively at Shopify Checkout, so Shopify is the
// source of truth for redemptions; this records the matching CHECKOUT_REDEMPTION debit so
// our ledger (WalletAccount.currentBalance + WalletTransaction history) stays in step.
//
// It reconciles by balance difference rather than parsing the order's gift-card
// transactions, so it depends only on readCustomerGiftCard (already validated) and never
// on an unvalidated transaction-shape. The key correctness guard: a raw ledger − card gap
// is NOT all redemption. By the ledger invariant,
//
//     card = ledger − (credits not yet synced to the card)
//
// so a credit that PR(A)'s projection hasn't mirrored yet also shows up as card < ledger.
// We subtract those unsynced credits before attributing anything to a redemption -
// otherwise a transient projection lag would book a false debit and erase real credit.
//
// Recording is idempotent: the (SHOPIFY_ORDER, orderId, CHECKOUT_REDEMPTION) unique key
// dedupes redelivered webhooks, and once booked the ledger matches the card so a re-run is
// a no-op. A card balance ABOVE the ledger is an out-of-band Shopify credit we can't
// attribute, so it is surfaced (card_ahead) rather than silently inflating the ledger.
//
// Every import is lazy so the unit test can inject all seams.

export type ReconcileAccount = {
  id: string;
  currentBalance: number; // ledger balance, minor units (paise)
  currency: string;
  shopifyGiftCardId: string | null;
  unsyncedCreditPaise: number; // Σ CREDIT amounts with giftCardSyncedAt IS NULL
};

export type ReconcileDeps = {
  loadAccount?: (params: { shopId: string; customerProfileId: string; currency: string }) => Promise<ReconcileAccount | null>;
  readCardBalancePaise?: (params: { shopId: string; shopDomain: string; customerProfileId: string; currency: string }) => Promise<number | null>;
  recordRedemption?: (params: {
    account: ReconcileAccount;
    shopId: string;
    customerProfileId: string;
    amountPaise: number;
    orderId: string;
    orderNumber?: string | null;
  }) => Promise<{ recorded: boolean; duplicate?: boolean; walletTransactionId?: string | null }>;
};

export type ReconcileResult =
  | { status: "no_customer" | "no_card" | "card_unreadable" | "in_sync" | "duplicate" }
  | { status: "card_ahead"; ledgerPaise: number; cardPaise: number }
  | { status: "redemption_recorded"; amountPaise: number; walletTransactionId: string | null }
  | { status: "failed"; reason: string };

async function loadAccountDefault(params: { shopId: string; customerProfileId: string; currency: string }): Promise<ReconcileAccount | null> {
  const { prisma } = await import("../db/prisma");
  const rows = await prisma.$queryRaw<Array<{ id: string; currentBalance: number; currency: string; shopifyGiftCardId: string | null; unsyncedCreditPaise: number }>>`
    SELECT wa."id", wa."currentBalance", wa."currency", wa."shopifyGiftCardId",
      COALESCE((
        SELECT SUM(wt."amount")::int FROM "WalletTransaction" wt
        WHERE wt."walletAccountId" = wa."id"
          AND wt."direction" = 'CREDIT'::"WalletDirection"
          AND wt."giftCardSyncedAt" IS NULL
      ), 0) AS "unsyncedCreditPaise"
    FROM "WalletAccount" wa
    WHERE wa."shopId" = ${params.shopId}
      AND wa."customerProfileId" = ${params.customerProfileId}
      AND wa."currency" = ${params.currency}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function readCardBalanceDefault(params: { shopId: string; shopDomain: string; customerProfileId: string; currency: string }): Promise<number | null> {
  const { readCustomerGiftCard } = await import("./gift-card");
  const res = await readCustomerGiftCard(params);
  if (!res.ok || !res.present) return null;
  return res.balancePaise;
}

async function recordRedemptionDefault(params: {
  account: ReconcileAccount;
  shopId: string;
  customerProfileId: string;
  amountPaise: number;
  orderId: string;
  orderNumber?: string | null;
}): Promise<{ recorded: boolean; duplicate?: boolean; walletTransactionId?: string | null }> {
  const { prisma } = await import("../db/prisma");
  const { randomUUID } = await import("crypto");
  return prisma.$transaction(async (tx: { $queryRaw: typeof prisma.$queryRaw; $executeRaw: typeof prisma.$executeRaw }) => {
    // Re-read the balance inside the transaction and clamp, so a concurrent credit/debit
    // can't drive the ledger negative; the unique key still dedupes per order.
    const rows = await tx.$queryRaw<Array<{ currentBalance: number }>>`
      SELECT "currentBalance" FROM "WalletAccount" WHERE "id" = ${params.account.id} FOR UPDATE
    `;
    const currentBalance = Math.max(0, Math.round(rows[0]?.currentBalance ?? params.account.currentBalance ?? 0));
    const amount = Math.min(params.amountPaise, currentBalance);
    if (amount <= 0) return { recorded: false, duplicate: false, walletTransactionId: null };

    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "WalletTransaction" (
        "id", "shopId", "walletAccountId", "customerProfileId", "direction", "transactionType", "amount", "currency",
        "sourceType", "sourceId", "sourceReference", "orderNumber", "reason", "createdByType", "createdById", "createdAt"
      ) VALUES (
        ${randomUUID()}, ${params.shopId}, ${params.account.id}, ${params.customerProfileId},
        'DEBIT'::"WalletDirection", 'CHECKOUT_REDEMPTION'::"WalletTransactionType", ${amount}, ${params.account.currency},
        'SHOPIFY_ORDER'::"WalletSourceType", ${params.orderId}, ${params.orderId}, ${params.orderNumber || null},
        'Store Credit used at checkout', 'SYSTEM'::"WalletActorType", 'shopify-webhook-orders-create', NOW()
      )
      ON CONFLICT ("sourceType", "sourceId", "transactionType") DO NOTHING
      RETURNING "id"
    `;
    const walletTransactionId = inserted[0]?.id || null;
    if (!walletTransactionId) return { recorded: false, duplicate: true, walletTransactionId: null };

    await tx.$executeRaw`
      UPDATE "WalletAccount" SET "currentBalance" = ${currentBalance - amount}, "updatedAt" = NOW() WHERE "id" = ${params.account.id}
    `;
    return { recorded: true, duplicate: false, walletTransactionId };
  });
}

export async function reconcileGiftCardRedemption(
  params: { shopId: string; shopDomain: string; customerProfileId: string; orderId: string; orderNumber?: string | null; currency?: string },
  deps: ReconcileDeps = {},
): Promise<ReconcileResult> {
  const customerProfileId = String(params.customerProfileId || "").trim();
  const orderId = String(params.orderId || "").trim();
  if (!customerProfileId) return { status: "no_customer" };
  if (!orderId) return { status: "failed", reason: "missing_order_id" };
  const currency = String(params.currency || "INR").trim() || "INR";

  const loadAccount = deps.loadAccount ?? loadAccountDefault;
  const readCardBalancePaise = deps.readCardBalancePaise ?? readCardBalanceDefault;
  const recordRedemption = deps.recordRedemption ?? recordRedemptionDefault;

  const account = await loadAccount({ shopId: params.shopId, customerProfileId, currency });
  if (!account || !account.shopifyGiftCardId) return { status: "no_card" };

  const cardPaise = await readCardBalancePaise({ shopId: params.shopId, shopDomain: params.shopDomain, customerProfileId, currency });
  if (cardPaise == null) return { status: "card_unreadable" };

  const ledgerPaise = Math.max(0, Math.round(account.currentBalance || 0));
  const unsyncedCreditPaise = Math.max(0, Math.round(account.unsyncedCreditPaise || 0));

  if (cardPaise > ledgerPaise) return { status: "card_ahead", ledgerPaise, cardPaise };

  // The gap that is genuinely a redemption, once pending (unsynced) credits are excluded.
  const redemptionPaise = ledgerPaise - cardPaise - unsyncedCreditPaise;
  if (redemptionPaise <= 0) return { status: "in_sync" };

  const res = await recordRedemption({ account, shopId: params.shopId, customerProfileId, amountPaise: redemptionPaise, orderId, orderNumber: params.orderNumber });
  if (res.duplicate) return { status: "duplicate" };
  if (!res.recorded) return { status: "failed", reason: "record_failed" };
  return { status: "redemption_recorded", amountPaise: redemptionPaise, walletTransactionId: res.walletTransactionId ?? null };
}
