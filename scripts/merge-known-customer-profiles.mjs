#!/usr/bin/env node
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

// Deliberately hard-coded: this is a one-time, pair-specific operational repair,
// not another entry point to the generic identity reconciliation engine.
const SHOP_ID = "3ea59c93-efbd-41d6-aede-7787b2e1eaee";
const SOURCE_ID = "d058f0e6-2544-4852-ae48-c4c8263162c9";
const TARGET_ID = "c2281142-a9dc-468a-99da-848a725e62dc";
const CONFIRMATION = "MERGE_D058_INTO_C228";
const ACTOR = "Sandeep";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
if (apply && !args.has(`--confirm=${CONFIRMATION}`)) {
  throw new Error(`Apply mode requires both --apply and --confirm=${CONFIRMATION}`);
}
if (!apply && [...args].some((arg) => arg.startsWith("--confirm="))) {
  throw new Error("--confirm is accepted only together with --apply");
}
if ([...args].some((arg) => arg !== "--apply" && arg !== `--confirm=${CONFIRMATION}`)) {
  throw new Error("Unknown argument. This script accepts only --apply and the exact confirmation token.");
}
if (SOURCE_ID === TARGET_ID) throw new Error("SOURCE and TARGET must be different");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const relations = [
  ["authSession", "AuthSession"],
  ["oTPChallenge", "OTPChallenge"],
  ["codAdvanceIntent", "CodAdvanceIntent"],
  ["megaskaOrder", "MegaskaOrder"],
  ["orderActionRequest", "OrderActionRequest"],
  ["productReview", "ProductReview"],
  ["reviewRequest", "ReviewRequest"],
  ["walletTransaction", "WalletTransaction"],
  ["walletReservation", "WalletReservation"],
  ["refundRequest", "RefundRequest"],
  ["gstDocument", "GstDocument"],
  ["gstParty", "GstParty"],
  ["expressCheckoutIntent", "ExpressCheckoutIntent"],
  ["checkoutRecoveryToken", "CheckoutRecoveryToken"],
  ["expressCheckoutAddressSnapshot", "ExpressCheckoutAddressSnapshot"],
];

const shopScopedModels = new Set([
  "OTPChallenge", "CodAdvanceIntent", "MegaskaOrder", "ProductReview", "ReviewRequest",
  "WalletTransaction", "RefundRequest", "GstDocument", "ExpressCheckoutIntent",
  "CheckoutRecoveryToken", "ExpressCheckoutAddressSnapshot",
]);

function normalizeShopifyCustomerId(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  const match = text.match(/^(?:gid:\/\/shopify\/Customer\/)?([0-9]+)$/i);
  if (!match) throw new Error(`Unsupported Shopify customer ID form: ${text}`);
  return match[1];
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function countsFor(db, customerProfileId) {
  const counts = {};
  for (const [delegate, model] of relations) {
    counts[model] = await db[delegate].count({ where: { customerProfileId } });
  }
  // Per the operational requirement, WalletAccount discovery is intentionally
  // keyed only by customerProfileId; its actual schema shopId is validated later.
  counts.WalletAccount = await db.walletAccount.count({ where: { customerProfileId } });
  counts.CustomerIdentityReconciliationPlan = await db.customerIdentityReconciliationPlan.count({
    where: { canonicalCustomerProfileId: customerProfileId },
  });
  counts.CustomerIdentityReconciliationAudit = await db.customerIdentityReconciliationAudit.count({
    where: { canonicalCustomerProfileId: customerProfileId },
  });
  return counts;
}

async function loadAndValidate(db) {
  const [source, target] = await Promise.all([
    db.customerProfile.findUnique({ where: { id: SOURCE_ID } }),
    db.customerProfile.findUnique({ where: { id: TARGET_ID } }),
  ]);
  if (!source || !target) throw new Error(`Both profiles must exist (source=${Boolean(source)}, target=${Boolean(target)})`);
  if (source.shopId !== SHOP_ID || target.shopId !== SHOP_ID) {
    throw new Error("Both profiles must belong to the hard-coded shop");
  }

  const [targetSessions, targetVerifiedOtps, sourceOrders, sourceReviews, sourceReviewRequests] = await Promise.all([
    db.authSession.count({ where: { customerProfileId: TARGET_ID } }),
    db.oTPChallenge.count({ where: { customerProfileId: TARGET_ID, status: "VERIFIED" } }),
    db.megaskaOrder.count({ where: { customerProfileId: SOURCE_ID } }),
    db.productReview.count({ where: { customerProfileId: SOURCE_ID } }),
    db.reviewRequest.count({ where: { customerProfileId: SOURCE_ID } }),
  ]);
  if (targetSessions + targetVerifiedOtps === 0) throw new Error("TARGET is not proven to be the OTP/login profile");
  if (sourceOrders + sourceReviews + sourceReviewRequests === 0) {
    throw new Error("SOURCE is not proven to be the historical order/review profile");
  }

  const sourceShopifyId = normalizeShopifyCustomerId(source.shopifyCustomerId);
  const targetShopifyId = normalizeShopifyCustomerId(target.shopifyCustomerId);
  if (sourceShopifyId && targetShopifyId && sourceShopifyId !== targetShopifyId) {
    throw new Error("Profiles have different Shopify customer identities; refusing to guess");
  }
  const canonicalShopifyId = targetShopifyId ?? sourceShopifyId;
  if (canonicalShopifyId) {
    const peers = await db.customerProfile.findMany({
      where: { shopId: SHOP_ID, shopifyCustomerId: { not: null }, id: { notIn: [SOURCE_ID, TARGET_ID] } },
      select: { id: true, shopifyCustomerId: true },
    });
    const conflict = peers.find((peer) => normalizeShopifyCustomerId(peer.shopifyCustomerId) === canonicalShopifyId);
    if (conflict) throw new Error(`Canonical Shopify identity is already active on profile ${conflict.id}`);
  }

  const sourceCounts = await countsFor(db, SOURCE_ID);
  return { source, target, sourceCounts, canonicalShopifyId };
}

async function validateTenantOwnership(db) {
  for (const [delegate, model] of relations) {
    if (!shopScopedModels.has(model)) continue;
    const count = await db[delegate].count({ where: { customerProfileId: SOURCE_ID, shopId: { not: SHOP_ID } } });
    if (count) throw new Error(`${model} has ${count} SOURCE rows outside the expected shop`);
  }
  const wallets = await db.walletAccount.findMany({ where: { customerProfileId: { in: [SOURCE_ID, TARGET_ID] } } });
  const wrongWallets = wallets.filter((wallet) => wallet.shopId !== SHOP_ID);
  if (wrongWallets.length) throw new Error(`WalletAccount has ${wrongWallets.length} rows outside the expected shop`);
  return wallets;
}

async function validateUniqueConflicts(db, wallets) {
  const priorMerge = await db.customerIdentityMerge.findUnique({ where: { sourceCustomerProfileId: SOURCE_ID }, select: { id: true } });
  if (priorMerge) throw new Error(`SOURCE already has a merge record: ${priorMerge.id}`);
  const sourceReviews = await db.productReview.findMany({
    where: { customerProfileId: SOURCE_ID, shopifyLineItemId: { not: null } },
    select: { id: true, shopId: true, shopifyLineItemId: true },
  });
  for (const review of sourceReviews) {
    const conflict = await db.productReview.findFirst({
      where: { customerProfileId: TARGET_ID, shopId: review.shopId, shopifyLineItemId: review.shopifyLineItemId },
      select: { id: true },
    });
    if (conflict) throw new Error(`ProductReview unique conflict: ${review.id} conflicts with ${conflict.id}`);
  }
  const keys = new Set();
  for (const wallet of wallets) {
    const key = `${wallet.customerProfileId}:${wallet.currency}`;
    if (keys.has(key)) throw new Error(`Unexpected duplicate wallet currency ${wallet.currency}`);
    keys.add(key);
  }
}

async function assertWalletLedger(db, wallet) {
  const rows = await db.walletTransaction.findMany({
    where: { walletAccountId: wallet.id }, select: { direction: true, amount: true, currency: true, customerProfileId: true, shopId: true },
  });
  const ledgerBalance = rows.reduce((sum, row) => sum + (row.direction === "CREDIT" ? row.amount : -row.amount), 0);
  if (rows.some((row) => row.currency !== wallet.currency || row.customerProfileId !== wallet.customerProfileId || row.shopId !== wallet.shopId)) {
    throw new Error(`Wallet ${wallet.id} has inconsistent ledger ownership/currency`);
  }
  if (ledgerBalance !== wallet.currentBalance) {
    throw new Error(`Wallet ${wallet.id} balance ${wallet.currentBalance} does not reconcile to ledger ${ledgerBalance}`);
  }
  const active = await db.walletReservation.aggregate({
    where: { walletAccountId: wallet.id, status: "ACTIVE" }, _sum: { reservedAmount: true },
  });
  if ((active._sum.reservedAmount ?? 0) > wallet.currentBalance) {
    throw new Error(`Wallet ${wallet.id} active reservations exceed its balance`);
  }
  return { ledgerBalance, transactionCount: rows.length };
}

async function mergeWallets(db, wallets, movedCounts) {
  const sourceWallets = wallets.filter((wallet) => wallet.customerProfileId === SOURCE_ID);
  const targetByCurrency = new Map(wallets.filter((wallet) => wallet.customerProfileId === TARGET_ID).map((wallet) => [wallet.currency, wallet]));
  for (const sourceWallet of sourceWallets) {
    await assertWalletLedger(db, sourceWallet);
    const targetWallet = targetByCurrency.get(sourceWallet.currency);
    if (!targetWallet) {
      movedCounts.WalletAccount += (await db.walletAccount.updateMany({ where: { id: sourceWallet.id, customerProfileId: SOURCE_ID }, data: { customerProfileId: TARGET_ID } })).count;
      movedCounts.WalletTransaction += (await db.walletTransaction.updateMany({ where: { walletAccountId: sourceWallet.id, customerProfileId: SOURCE_ID }, data: { customerProfileId: TARGET_ID } })).count;
      movedCounts.WalletReservation += (await db.walletReservation.updateMany({ where: { walletAccountId: sourceWallet.id, customerProfileId: SOURCE_ID }, data: { customerProfileId: TARGET_ID } })).count;
      await assertWalletLedger(db, { ...sourceWallet, customerProfileId: TARGET_ID });
      targetByCurrency.set(sourceWallet.currency, { ...sourceWallet, customerProfileId: TARGET_ID });
      continue;
    }

    await assertWalletLedger(db, targetWallet);
    const expectedBalance = targetWallet.currentBalance + sourceWallet.currentBalance;
    movedCounts.WalletTransaction += (await db.walletTransaction.updateMany({ where: { walletAccountId: sourceWallet.id, customerProfileId: SOURCE_ID }, data: { walletAccountId: targetWallet.id, customerProfileId: TARGET_ID } })).count;
    movedCounts.WalletReservation += (await db.walletReservation.updateMany({ where: { walletAccountId: sourceWallet.id, customerProfileId: SOURCE_ID }, data: { walletAccountId: targetWallet.id, customerProfileId: TARGET_ID } })).count;
    await db.walletAccount.update({ where: { id: targetWallet.id }, data: { currentBalance: expectedBalance } });
    await db.walletAccount.delete({ where: { id: sourceWallet.id } });
    movedCounts.WalletAccount += 1;
    const surviving = { ...targetWallet, currentBalance: expectedBalance };
    await assertWalletLedger(db, surviving);
    targetByCurrency.set(sourceWallet.currency, surviving);
  }
}

async function executeMerge(tx) {
  const validation = await loadAndValidate(tx);
  const wallets = await validateTenantOwnership(tx);
  await validateUniqueConflicts(tx, wallets);
  const movedCounts = Object.fromEntries(Object.keys(validation.sourceCounts).map((model) => [model, 0]));

  // Retire the duplicate representation first, then install one numeric canonical identity on TARGET.
  if (validation.source.shopifyCustomerId != null) await tx.customerProfile.update({ where: { id: SOURCE_ID }, data: { shopifyCustomerId: null } });
  if (validation.target.shopifyCustomerId !== validation.canonicalShopifyId) {
    await tx.customerProfile.update({ where: { id: TARGET_ID }, data: { shopifyCustomerId: validation.canonicalShopifyId } });
  }

  await mergeWallets(tx, wallets, movedCounts);
  for (const [delegate, model] of relations) {
    if (model === "WalletTransaction" || model === "WalletReservation") continue;
    movedCounts[model] = (await tx[delegate].updateMany({ where: { customerProfileId: SOURCE_ID }, data: { customerProfileId: TARGET_ID } })).count;
  }
  movedCounts.CustomerIdentityReconciliationPlan = (await tx.customerIdentityReconciliationPlan.updateMany({ where: { canonicalCustomerProfileId: SOURCE_ID }, data: { canonicalCustomerProfileId: TARGET_ID } })).count;
  movedCounts.CustomerIdentityReconciliationAudit = (await tx.customerIdentityReconciliationAudit.updateMany({ where: { canonicalCustomerProfileId: SOURCE_ID }, data: { canonicalCustomerProfileId: TARGET_ID } })).count;

  const remaining = await countsFor(tx, SOURCE_ID);
  const remainingTotal = Object.values(remaining).reduce((sum, count) => sum + count, 0);
  if (remainingTotal !== 0) throw new Error(`SOURCE still has dependencies: ${JSON.stringify(remaining)}`);
  const postCounts = await countsFor(tx, TARGET_ID);
  for (const model of ["MegaskaOrder", "ProductReview", "ReviewRequest"]) {
    if (postCounts[model] < validation.sourceCounts[model]) throw new Error(`${model} movement verification failed`);
  }
  if (postCounts.AuthSession + postCounts.OTPChallenge === 0) throw new Error("TARGET lost OTP/login identity evidence");

  const auditState = { shopId: SHOP_ID, sourceProfileId: SOURCE_ID, targetProfileId: TARGET_ID, actor: ACTOR, movedCounts, verification: "VERIFIED" };
  const beforeHash = hash({ source: validation.source, target: validation.target, counts: validation.sourceCounts });
  const afterHash = hash(auditState);
  const checksum = hash({ ...auditState, timestamp: new Date().toISOString() });
  const plan = await tx.customerIdentityReconciliationPlan.create({ data: {
    shopId: SHOP_ID, canonicalCustomerProfileId: TARGET_ID, sourceCustomerProfileIds: [SOURCE_ID],
    classification: "KNOWN_DUPLICATE_ONE_TIME_MERGE", status: "APPLIED", createdBy: ACTOR,
    approvedBy: ACTOR, approvedAt: new Date(), appliedAt: new Date(), checksum,
    sourceStateChecksum: beforeHash, plan: auditState,
  } });
  await tx.customerIdentityMerge.create({ data: { shopId: SHOP_ID, sourceCustomerProfileId: SOURCE_ID, targetCustomerProfileId: TARGET_ID, planId: plan.id } });
  await tx.customerIdentityReconciliationAudit.create({ data: {
    planId: plan.id, shopId: SHOP_ID, canonicalCustomerProfileId: TARGET_ID,
    sourceCustomerProfileIds: [SOURCE_ID], classification: "KNOWN_DUPLICATE_ONE_TIME_MERGE",
    affectedRecordCounts: movedCounts, result: "MERGED_AND_VERIFIED", actor: ACTOR,
    beforeIntegrityHash: beforeHash, afterIntegrityHash: afterHash,
  } });

  await tx.customerProfile.delete({ where: { id: SOURCE_ID } });
  if (await tx.customerProfile.findUnique({ where: { id: SOURCE_ID }, select: { id: true } })) throw new Error("SOURCE deletion verification failed");
  return { status: "MERGED_AND_VERIFIED", sourceProfileId: SOURCE_ID, targetProfileId: TARGET_ID, movedCounts, remainingSourceDependencies: 0, sourceDeleted: true };
}

try {
  const validation = await loadAndValidate(prisma);
  const wallets = await validateTenantOwnership(prisma);
  await validateUniqueConflicts(prisma, wallets);
  for (const wallet of wallets) await assertWalletLedger(prisma, wallet);
  console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", shopId: SHOP_ID, sourceProfileId: SOURCE_ID, targetProfileId: TARGET_ID, countsBeforeChanges: validation.sourceCounts }, null, 2));
  if (!apply) {
    console.log(JSON.stringify({ status: "DRY_RUN_VERIFIED", changesApplied: false, applyRequires: `--apply --confirm=${CONFIRMATION}` }, null, 2));
  } else {
    const result = await prisma.$transaction(executeMerge, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
