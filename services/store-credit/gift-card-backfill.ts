// One-time migration: project existing store-credit balances onto real Shopify gift cards
// so credit earned before the gift-card architecture becomes spendable at native checkout.
//
// For each WalletAccount that still has a positive ledger balance but no gift card, it
// mints a card for the full balance (creditCustomerGiftCard creates it and saves the ref)
// and then stamps giftCardSyncedAt on that account's still-unsynced CREDIT entries - the
// whole balance is now represented in the card's initial value, so leaving those credits
// "unsynced" would make reconcile() under-count later redemptions. No ledger amount
// changes; this only mirrors the existing balance onto a card.
//
// Idempotent: it only selects cardless accounts, so a re-run skips everything already
// migrated. Every import is lazy so the unit test can inject all seams.

type CreditResult =
  | { ok: true; created: boolean; giftCardId: string; last4: string }
  | { ok: false; reason: string };

type CreditFn = (params: {
  shopId: string;
  shopDomain: string;
  customerProfileId: string;
  amountPaise: number;
  currency?: string;
  note?: string;
}) => Promise<CreditResult>;

export type BackfillAccount = {
  id: string;
  shopId: string;
  customerProfileId: string;
  currency: string;
  currentBalance: number; // minor units (paise)
};

export type BackfillDeps = {
  listAccounts?: (params: { shopId?: string; limit: number }) => Promise<BackfillAccount[]>;
  resolveShopDomain?: (shopId: string) => Promise<string | null>;
  credit?: CreditFn;
  markAccountCreditsSynced?: (accountId: string, at: Date) => Promise<void>;
  // Fired for each migrated account so the customer is emailed their newly generated code.
  notifyCreated?: (params: { shopId: string; customerProfileId: string }) => void;
  now?: () => Date;
};

export type BackfillItemResult = {
  accountId: string;
  status: "created" | "skipped_no_domain" | "failed";
  last4?: string;
  reason?: string;
};

export type BackfillSummary = {
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  items: BackfillItemResult[];
};

async function listAccountsDefault(params: { shopId?: string; limit: number }): Promise<BackfillAccount[]> {
  const { prisma } = await import("../db/prisma");
  if (params.shopId) {
    return prisma.$queryRaw<Array<BackfillAccount>>`
      SELECT "id", "shopId", "customerProfileId", "currency", "currentBalance"
      FROM "WalletAccount"
      WHERE "currentBalance" > 0 AND "shopifyGiftCardId" IS NULL AND "shopId" = ${params.shopId}
      ORDER BY "createdAt" ASC
      LIMIT ${params.limit}
    `;
  }
  return prisma.$queryRaw<Array<BackfillAccount>>`
    SELECT "id", "shopId", "customerProfileId", "currency", "currentBalance"
    FROM "WalletAccount"
    WHERE "currentBalance" > 0 AND "shopifyGiftCardId" IS NULL
    ORDER BY "createdAt" ASC
    LIMIT ${params.limit}
  `;
}

async function resolveShopDomainDefault(shopId: string): Promise<string | null> {
  const { prisma } = await import("../db/prisma");
  const rows = await prisma.$queryRaw<Array<{ shopDomain: string | null; myshopifyDomain: string | null }>>`
    SELECT "shopDomain", "myshopifyDomain" FROM "Shop" WHERE "id" = ${shopId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return row.myshopifyDomain || row.shopDomain || null;
}

async function creditDefault(params: Parameters<CreditFn>[0]): Promise<CreditResult> {
  const { creditCustomerGiftCard } = await import("./gift-card");
  return creditCustomerGiftCard(params);
}

async function markAccountCreditsSyncedDefault(accountId: string, at: Date): Promise<void> {
  const { prisma } = await import("../db/prisma");
  await prisma.$executeRaw`
    UPDATE "WalletTransaction" SET "giftCardSyncedAt" = ${at}
    WHERE "walletAccountId" = ${accountId}
      AND "direction" = 'CREDIT'::"WalletDirection"
      AND "giftCardSyncedAt" IS NULL
  `;
}

export async function backfillGiftCardsForExistingBalances(
  params: { shopId?: string; limit?: number } = {},
  deps: BackfillDeps = {},
): Promise<BackfillSummary> {
  const rawLimit = params.limit == null || Number.isNaN(Number(params.limit)) ? 100 : Math.round(Number(params.limit));
  const limit = Math.min(Math.max(rawLimit, 1), 500);
  const listAccounts = deps.listAccounts ?? listAccountsDefault;
  const resolveShopDomain = deps.resolveShopDomain ?? resolveShopDomainDefault;
  const credit = deps.credit ?? creditDefault;
  const markAccountCreditsSynced = deps.markAccountCreditsSynced ?? markAccountCreditsSyncedDefault;
  const notifyCreated = deps.notifyCreated ?? ((p) => {
    void import("../notifications/store-credit").then((m) => m.notifyGiftCardCodeGenerated(p)).catch(() => {});
  });
  const now = deps.now ?? (() => new Date());

  const accounts = await listAccounts({ shopId: params.shopId, limit });
  const items: BackfillItemResult[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const account of accounts) {
    const shopDomain = await resolveShopDomain(account.shopId);
    if (!shopDomain) {
      skipped += 1;
      items.push({ accountId: account.id, status: "skipped_no_domain" });
      continue;
    }

    const res = await credit({
      shopId: account.shopId,
      shopDomain,
      customerProfileId: account.customerProfileId,
      amountPaise: Math.max(0, Math.round(account.currentBalance || 0)),
      currency: account.currency,
      note: "Store credit balance migrated to gift card",
    });
    if (!res.ok) {
      failed += 1;
      items.push({ accountId: account.id, status: "failed", reason: res.reason });
      continue;
    }

    await markAccountCreditsSynced(account.id, now());
    notifyCreated({ shopId: account.shopId, customerProfileId: account.customerProfileId });
    created += 1;
    items.push({ accountId: account.id, status: "created", last4: res.last4 });
  }

  return { processed: accounts.length, created, skipped, failed, items };
}
