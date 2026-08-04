// Projects a wallet CREDIT ledger entry onto the customer's Shopify gift card so the
// balance becomes spendable at native Shopify Checkout. The WalletTransaction ledger is
// the source of truth; the gift card is a projection of it.
//
// This runs OUTSIDE the settlement DB transaction because it makes an external Admin API
// call - holding a DB transaction open across the network would risk lock timeouts, and
// a momentary Shopify outage must never roll back a ledger credit the customer has
// already earned. Instead it is durably retryable: each credit entry is stamped
// `giftCardSyncedAt` only AFTER the Shopify credit succeeds, so a failure (Shopify down,
// gift-card scope not yet consented) leaves the marker NULL for a later retry.
//
// Only CREDIT-direction entries are projected. Debits are redemptions, which are spent
// on the card natively at checkout and reconciled separately - crediting the card for a
// debit would double the balance.
//
// Every import is lazy so the unit test can inject all seams without loading the Shopify
// admin / Prisma modules.

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

// The subset of a WalletTransaction row the projection needs.
export type ProjectionTransaction = {
  id: string;
  shopId: string;
  customerProfileId: string;
  currency: string;
  direction: string; // "CREDIT" | "DEBIT" | "NEUTRAL"
  amount: number; // minor units (paise)
  reason: string | null;
  giftCardSyncedAt: Date | string | null;
};

export type ProjectionDeps = {
  loadTransaction?: (id: string) => Promise<ProjectionTransaction | null>;
  resolveShopDomain?: (shopId: string) => Promise<string | null>;
  credit?: CreditFn;
  markSynced?: (id: string, at: Date) => Promise<void>;
  now?: () => Date;
};

export type ProjectionResult =
  | { status: "created" | "topped_up"; giftCardId: string; last4: string }
  | { status: "already_synced" }
  | { status: "skipped_not_credit" }
  | { status: "skipped_no_shop_domain" }
  | { status: "not_found" }
  | { status: "failed"; reason: string };

async function loadTransactionDefault(id: string): Promise<ProjectionTransaction | null> {
  const { prisma } = await import("../db/prisma");
  const rows = await prisma.$queryRaw<Array<ProjectionTransaction>>`
    SELECT "id", "shopId", "customerProfileId", "currency",
           "direction"::text AS "direction", "amount", "reason", "giftCardSyncedAt"
    FROM "WalletTransaction"
    WHERE "id" = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function resolveShopDomainDefault(shopId: string): Promise<string | null> {
  const { prisma } = await import("../db/prisma");
  const rows = await prisma.$queryRaw<Array<{ shopDomain: string | null; myshopifyDomain: string | null }>>`
    SELECT "shopDomain", "myshopifyDomain" FROM "Shop" WHERE "id" = ${shopId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  // Prefer the canonical *.myshopify.com the Admin API keys off; fall back to the
  // configured shop domain (resolveShopConfig accepts either).
  return row.myshopifyDomain || row.shopDomain || null;
}

async function markSyncedDefault(id: string, at: Date): Promise<void> {
  const { prisma } = await import("../db/prisma");
  await prisma.$executeRaw`
    UPDATE "WalletTransaction" SET "giftCardSyncedAt" = ${at} WHERE "id" = ${id}
  `;
}

async function creditDefault(params: Parameters<CreditFn>[0]): Promise<CreditResult> {
  const { creditCustomerGiftCard } = await import("./gift-card");
  return creditCustomerGiftCard(params);
}

// Idempotent, best-effort projection of a single ledger credit onto the gift card.
// Never throws for a business outcome - the caller (settlement) has already committed
// the ledger and must not be rolled back by a gift-card hiccup; a NULL marker is left
// behind so a retry (or a later reconciliation pass) can complete it.
export async function projectCreditToGiftCard(
  walletTransactionId: string,
  deps: ProjectionDeps = {},
): Promise<ProjectionResult> {
  const loadTransaction = deps.loadTransaction ?? loadTransactionDefault;
  const resolveShopDomain = deps.resolveShopDomain ?? resolveShopDomainDefault;
  const markSynced = deps.markSynced ?? markSyncedDefault;
  const credit = deps.credit ?? creditDefault;
  const now = deps.now ?? (() => new Date());

  const tx = await loadTransaction(walletTransactionId);
  if (!tx) return { status: "not_found" };
  if (tx.direction !== "CREDIT") return { status: "skipped_not_credit" };
  if (tx.giftCardSyncedAt) return { status: "already_synced" };

  const shopDomain = await resolveShopDomain(tx.shopId);
  if (!shopDomain) return { status: "skipped_no_shop_domain" };

  const res = await credit({
    shopId: tx.shopId,
    shopDomain,
    customerProfileId: tx.customerProfileId,
    amountPaise: tx.amount,
    currency: tx.currency,
    note: tx.reason || "LoopD2C store credit",
  });
  if (!res.ok) return { status: "failed", reason: res.reason };

  // Stamp the marker only after the external credit succeeded. If this write fails, the
  // credit already landed on the card but the marker stays NULL, so a retry could
  // double-credit - Phase C reconciliation (compare card balance to ledger credits)
  // detects and corrects that drift. Marking after (never before) crediting is the safe
  // ordering: the alternative loses credit on a mark-then-fail.
  await markSynced(tx.id, now());
  return res.created
    ? { status: "created", giftCardId: res.giftCardId, last4: res.last4 }
    : { status: "topped_up", giftCardId: res.giftCardId, last4: res.last4 };
}
