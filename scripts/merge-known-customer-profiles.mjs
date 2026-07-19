#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const SHOP_ID = "3ea59c93-efbd-41d6-aede-7787b2e1eaee";
const SOURCE_ID = "d058f0e6-2544-4852-ae48-c4c8263162c9";
const TARGET_ID = "c2281142-a9dc-468a-99da-848a725e62dc";
const CONFIRM_TOKEN = "MERGE_D058_INTO_C228";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const expectedConfirmation = `--confirm=${CONFIRM_TOKEN}`;

const DIRECT_DEPENDENCIES = [
  ["AuthSession", "authSession", "customerProfileId"],
  ["OTPChallenge", "oTPChallenge", "customerProfileId"],
  ["OrderActionRequest", "orderActionRequest", "customerProfileId"],
  ["CodAdvanceIntent", "codAdvanceIntent", "customerProfileId"],
  ["MegaskaOrder", "megaskaOrder", "customerProfileId"],
  ["ReviewRequest", "reviewRequest", "customerProfileId"],
  ["ProductReview", "productReview", "customerProfileId"],
  ["WalletAccount", "walletAccount", "customerProfileId"],
  ["WalletTransaction", "walletTransaction", "customerProfileId"],
  ["WalletReservation", "walletReservation", "customerProfileId"],
  ["RefundRequest", "refundRequest", "customerProfileId"],
  ["GstDocument", "gstDocument", "customerProfileId"],
  ["GstParty", "gstParty", "customerProfileId"],
  ["CheckoutRecoveryToken", "checkoutRecoveryToken", "customerProfileId"],
  ["CustomerIdentityReconciliationPlan", "customerIdentityReconciliationPlan", "canonicalCustomerProfileId"],
  ["CustomerIdentityReconciliationAudit", "customerIdentityReconciliationAudit", "canonicalCustomerProfileId"],
];

const NON_WALLET_UPDATES = DIRECT_DEPENDENCIES.filter(([, delegate]) => ![
  "walletAccount",
  "walletTransaction",
  "walletReservation",
  "customerIdentityReconciliationPlan",
  "customerIdentityReconciliationAudit",
].includes(delegate));

const FILL_ONLY_FIELDS = [
  "phoneE164",
  "fullName",
  "firstName",
  "lastName",
  "email",
  "addressLine1",
  "addressLine2",
  "city",
  "stateProvince",
  "postalCode",
  "countryRegion",
  "phoneVerifiedAt",
  "profileCompletedAt",
];

function fail(message, details) {
  const error = new Error(message);
  if (details !== undefined) error.details = details;
  throw error;
}

function validateArguments() {
  const allowed = new Set(["--apply", expectedConfirmation]);
  const unknown = args.filter((arg) => !allowed.has(arg));
  if (unknown.length) fail("Unknown command-line argument", { unknown });
  if (args.filter((arg) => arg === "--apply").length > 1 || args.filter((arg) => arg === expectedConfirmation).length > 1) {
    fail("Command-line arguments must not be repeated");
  }
  if (apply && !args.includes(expectedConfirmation)) {
    fail("Apply mode requires the exact confirmation token", { required: `--apply ${expectedConfirmation}` });
  }
  if (!apply && args.some((arg) => arg.startsWith("--confirm="))) {
    fail("--confirm may only be used with --apply");
  }
  if (SOURCE_ID === TARGET_ID) fail("SOURCE_ID and TARGET_ID must differ");
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is required");
}

function normalizeShopifyCustomerId(value) {
  if (value == null || String(value).trim() === "") return null;
  const match = String(value).trim().match(/^(?:gid:\/\/shopify\/Customer\/)?([0-9]+)$/i);
  if (!match) fail("Unsupported Shopify customer ID format", { value: String(value) });
  return match[1];
}

function sanitizedProfile(profile) {
  return Object.fromEntries(Object.entries(profile).filter(([key]) => !/token|secret|password|hash/i.test(key)));
}

function diagnostic(label, value) {
  process.stderr.write(`${JSON.stringify({ [label]: value })}\n`);
}

async function dependencyCounts(db, customerProfileId) {
  const entries = await Promise.all(DIRECT_DEPENDENCIES.map(async ([name, delegate, field]) => [
    name,
    await db[delegate].count({ where: { [field]: customerProfileId } }),
  ]));
  return Object.fromEntries(entries);
}

async function mergeScalarCounts(db, customerProfileId) {
  const [asSource, asTarget] = await Promise.all([
    db.customerIdentityMerge.count({ where: { sourceCustomerProfileId: customerProfileId } }),
    db.customerIdentityMerge.count({ where: { targetCustomerProfileId: customerProfileId } }),
  ]);
  return { sourceCustomerProfileId: asSource, targetCustomerProfileId: asTarget };
}

async function loadProfiles(db) {
  const [source, target] = await Promise.all([
    db.customerProfile.findUnique({ where: { id: SOURCE_ID } }),
    db.customerProfile.findUnique({ where: { id: TARGET_ID } }),
  ]);
  if (!source || !target) fail("Both SOURCE and TARGET profiles must exist", { sourceExists: Boolean(source), targetExists: Boolean(target) });
  if (source.shopId !== SHOP_ID || target.shopId !== SHOP_ID) {
    fail("Both profiles must belong to SHOP_ID", { sourceShopId: source.shopId, targetShopId: target.shopId, expectedShopId: SHOP_ID });
  }

  const sourceShopifyId = normalizeShopifyCustomerId(source.shopifyCustomerId);
  const targetShopifyId = normalizeShopifyCustomerId(target.shopifyCustomerId);
  if (sourceShopifyId && targetShopifyId && sourceShopifyId !== targetShopifyId) {
    fail("SOURCE and TARGET represent different Shopify customers", { sourceShopifyId, targetShopifyId });
  }
  return { source, target };
}

async function productReviewCollisions(db) {
  const sourceReviews = await db.productReview.findMany({
    where: { customerProfileId: SOURCE_ID, shopifyLineItemId: { not: null } },
    select: { id: true, shopId: true, shopifyLineItemId: true },
  });
  const collisions = [];
  for (const review of sourceReviews) {
    const target = await db.productReview.findFirst({
      where: {
        customerProfileId: TARGET_ID,
        shopId: review.shopId,
        shopifyLineItemId: review.shopifyLineItemId,
      },
      select: { id: true },
    });
    if (target) collisions.push({ sourceProductReviewId: review.id, targetProductReviewId: target.id });
  }
  return collisions;
}

async function inspectWallet(db, wallet) {
  if (wallet.shopId !== SHOP_ID) fail("Wallet belongs to an unexpected shop", { walletId: wallet.id, shopId: wallet.shopId });
  const [transactions, reservations] = await Promise.all([
    db.walletTransaction.findMany({
      where: { walletAccountId: wallet.id },
      select: { id: true, shopId: true, customerProfileId: true, currency: true },
    }),
    db.walletReservation.findMany({
      where: { walletAccountId: wallet.id },
      select: { id: true, shopId: true, customerProfileId: true, currency: true },
    }),
  ]);
  const invalidTransactions = transactions.filter((row) => row.shopId !== wallet.shopId || row.customerProfileId !== wallet.customerProfileId || row.currency !== wallet.currency);
  const invalidReservations = reservations.filter((row) => row.shopId !== wallet.shopId || row.customerProfileId !== wallet.customerProfileId || row.currency !== wallet.currency);
  if (invalidTransactions.length || invalidReservations.length) {
    fail("Wallet ledger ownership or currency is inconsistent; refusing to guess", {
      walletId: wallet.id,
      invalidTransactionIds: invalidTransactions.map(({ id }) => id),
      invalidReservationIds: invalidReservations.map(({ id }) => id),
    });
  }
  return { transactionCount: transactions.length, reservationCount: reservations.length };
}

async function buildWalletPlan(db) {
  const wallets = await db.walletAccount.findMany({
    where: { customerProfileId: { in: [SOURCE_ID, TARGET_ID] } },
    orderBy: [{ currency: "asc" }, { customerProfileId: "asc" }],
  });
  const sourceWallets = wallets.filter((wallet) => wallet.customerProfileId === SOURCE_ID);
  const targetByKey = new Map(wallets.filter((wallet) => wallet.customerProfileId === TARGET_ID).map((wallet) => [`${wallet.shopId}:${wallet.currency}`, wallet]));
  const plan = [];
  for (const sourceWallet of sourceWallets) {
    const sourceDetails = await inspectWallet(db, sourceWallet);
    const targetWallet = targetByKey.get(`${sourceWallet.shopId}:${sourceWallet.currency}`);
    if (!targetWallet) {
      plan.push({
        action: "REASSIGN_WALLET",
        currency: sourceWallet.currency,
        sourceWalletId: sourceWallet.id,
        currentBalance: sourceWallet.currentBalance,
        ...sourceDetails,
      });
      continue;
    }
    const targetDetails = await inspectWallet(db, targetWallet);
    plan.push({
      action: "CONSOLIDATE_WALLETS",
      currency: sourceWallet.currency,
      sourceWalletId: sourceWallet.id,
      targetWalletId: targetWallet.id,
      sourceCurrentBalance: sourceWallet.currentBalance,
      targetCurrentBalance: targetWallet.currentBalance,
      expectedCurrentBalance: sourceWallet.currentBalance + targetWallet.currentBalance,
      sourceTransactionCount: sourceDetails.transactionCount,
      sourceReservationCount: sourceDetails.reservationCount,
      targetTransactionCount: targetDetails.transactionCount,
      targetReservationCount: targetDetails.reservationCount,
    });
  }
  return plan;
}

function fillOnlyData(source, target) {
  const data = {};
  for (const field of FILL_ONLY_FIELDS) {
    const targetEmpty = target[field] == null || (typeof target[field] === "string" && target[field].trim() === "");
    const sourcePresent = source[field] != null && (typeof source[field] !== "string" || source[field].trim() !== "");
    if (targetEmpty && sourcePresent) data[field] = source[field];
  }
  return data;
}

async function applyWalletPlan(tx, walletPlan, movedCounts) {
  for (const item of walletPlan) {
    if (item.action === "REASSIGN_WALLET") {
      movedCounts.WalletTransaction += (await tx.walletTransaction.updateMany({
        where: { walletAccountId: item.sourceWalletId, customerProfileId: SOURCE_ID },
        data: { customerProfileId: TARGET_ID },
      })).count;
      movedCounts.WalletReservation += (await tx.walletReservation.updateMany({
        where: { walletAccountId: item.sourceWalletId, customerProfileId: SOURCE_ID },
        data: { customerProfileId: TARGET_ID },
      })).count;
      await tx.walletAccount.update({ where: { id: item.sourceWalletId }, data: { customerProfileId: TARGET_ID } });
      movedCounts.WalletAccount += 1;
      continue;
    }

    diagnostic("walletBalanceChange", {
      currency: item.currency,
      sourceWalletId: item.sourceWalletId,
      targetWalletId: item.targetWalletId,
      before: { source: item.sourceCurrentBalance, target: item.targetCurrentBalance },
      after: item.expectedCurrentBalance,
    });
    movedCounts.WalletTransaction += (await tx.walletTransaction.updateMany({
      where: { walletAccountId: item.sourceWalletId, customerProfileId: SOURCE_ID },
      data: { walletAccountId: item.targetWalletId, customerProfileId: TARGET_ID },
    })).count;
    movedCounts.WalletReservation += (await tx.walletReservation.updateMany({
      where: { walletAccountId: item.sourceWalletId, customerProfileId: SOURCE_ID },
      data: { walletAccountId: item.targetWalletId, customerProfileId: TARGET_ID },
    })).count;
    const [transactionsLeft, reservationsLeft] = await Promise.all([
      tx.walletTransaction.count({ where: { walletAccountId: item.sourceWalletId } }),
      tx.walletReservation.count({ where: { walletAccountId: item.sourceWalletId } }),
    ]);
    if (transactionsLeft || reservationsLeft) {
      fail("SOURCE wallet still has ledger dependencies", { walletId: item.sourceWalletId, transactionsLeft, reservationsLeft });
    }
    await tx.walletAccount.update({
      where: { id: item.targetWalletId },
      data: { currentBalance: item.expectedCurrentBalance },
    });
    await tx.walletAccount.delete({ where: { id: item.sourceWalletId } });
    movedCounts.WalletAccount += 1;
  }
}

async function assertProductReviewUniqueness(tx) {
  const targetReviews = await tx.productReview.findMany({
    where: { customerProfileId: TARGET_ID, shopifyLineItemId: { not: null } },
    select: { id: true, shopId: true, shopifyLineItemId: true },
  });
  const seen = new Map();
  for (const review of targetReviews) {
    const key = `${review.shopId}:${review.shopifyLineItemId}`;
    if (seen.has(key)) fail("ProductReview uniqueness verification failed", { conflictingProductReviewIds: [seen.get(key), review.id] });
    seen.set(key, review.id);
  }
}

async function executeMerge(tx) {
  const { source, target } = await loadProfiles(tx);
  const sourceCounts = await dependencyCounts(tx, SOURCE_ID);
  const collisions = await productReviewCollisions(tx);
  if (collisions.length) fail("ProductReview collisions prevent the merge", { productReviewCollisions: collisions });
  const walletPlan = await buildWalletPlan(tx);
  const movedCounts = Object.fromEntries(DIRECT_DEPENDENCIES.map(([name]) => [name, 0]));

  const profileData = fillOnlyData(source, target);
  if (Object.keys(profileData).length) await tx.customerProfile.update({ where: { id: TARGET_ID }, data: profileData });

  await applyWalletPlan(tx, walletPlan, movedCounts);
  for (const [name, delegate, field] of NON_WALLET_UPDATES) {
    movedCounts[name] = (await tx[delegate].updateMany({ where: { [field]: SOURCE_ID }, data: { [field]: TARGET_ID } })).count;
  }
  movedCounts.CustomerIdentityReconciliationPlan = (await tx.customerIdentityReconciliationPlan.updateMany({
    where: { canonicalCustomerProfileId: SOURCE_ID }, data: { canonicalCustomerProfileId: TARGET_ID },
  })).count;
  movedCounts.CustomerIdentityReconciliationAudit = (await tx.customerIdentityReconciliationAudit.updateMany({
    where: { canonicalCustomerProfileId: SOURCE_ID }, data: { canonicalCustomerProfileId: TARGET_ID },
  })).count;

  await tx.customerIdentityMerge.updateMany({
    where: { targetCustomerProfileId: SOURCE_ID, sourceCustomerProfileId: { not: SOURCE_ID } },
    data: { targetCustomerProfileId: TARGET_ID },
  });

  const remainingSourceDependencies = await dependencyCounts(tx, SOURCE_ID);
  if (Object.values(remainingSourceDependencies).some((count) => count !== 0)) {
    fail("SOURCE still has direct dependencies", { remainingSourceDependencies });
  }
  await assertProductReviewUniqueness(tx);
  const retained = await tx.customerProfile.findUnique({ where: { id: TARGET_ID }, select: { id: true, shopId: true, shopifyCustomerId: true } });
  if (!retained || retained.shopId !== SHOP_ID) fail("TARGET no longer belongs to SHOP_ID");
  if (retained.shopifyCustomerId !== target.shopifyCustomerId) fail("TARGET Shopify identity changed unexpectedly");

  await tx.customerProfile.delete({ where: { id: SOURCE_ID } });
  const [deletedSource, survivingTarget, finalTargetCounts, targetWallets] = await Promise.all([
    tx.customerProfile.findUnique({ where: { id: SOURCE_ID }, select: { id: true } }),
    tx.customerProfile.findUnique({ where: { id: TARGET_ID }, select: { id: true, shopId: true } }),
    dependencyCounts(tx, TARGET_ID),
    tx.walletAccount.findMany({
      where: { customerProfileId: TARGET_ID },
      select: { id: true, shopId: true, currency: true, currentBalance: true },
      orderBy: { currency: "asc" },
    }),
  ]);
  if (deletedSource) fail("SOURCE deletion verification failed");
  if (!survivingTarget || survivingTarget.shopId !== SHOP_ID) fail("TARGET survival verification failed");
  diagnostic("finalTargetDependencyCounts", finalTargetCounts);
  diagnostic("targetWalletBalances", targetWallets);
  return {
    status: "MERGED_AND_VERIFIED",
    shopId: SHOP_ID,
    sourceProfileId: SOURCE_ID,
    targetProfileId: TARGET_ID,
    movedCounts,
    remainingSourceDependencies,
    sourceDeleted: true,
    targetWallets,
  };
}

let prisma;
try {
  validateArguments();
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const { source, target } = await loadProfiles(prisma);
  const [sourceCounts, mergeScalarReferences, collisions, walletPlan] = await Promise.all([
    dependencyCounts(prisma, SOURCE_ID),
    mergeScalarCounts(prisma, SOURCE_ID),
    productReviewCollisions(prisma),
    buildWalletPlan(prisma),
  ]);
  diagnostic("profiles", { source: sanitizedProfile(source), target: sanitizedProfile(target) });
  diagnostic("sourceDependencyCounts", sourceCounts);
  diagnostic("customerIdentityMergeScalarReferences", mergeScalarReferences);
  if (collisions.length) {
    diagnostic("productReviewCollisions", collisions);
    fail("ProductReview collisions prevent the merge", { conflictingProductReviewIds: collisions });
  }

  if (!apply) {
    console.log(JSON.stringify({
      status: "DRY_RUN",
      shopId: SHOP_ID,
      sourceProfileId: SOURCE_ID,
      targetProfileId: TARGET_ID,
      sourceCounts,
      productReviewCollisions: collisions,
      walletPlan,
    }));
  } else {
    const result = await prisma.$transaction(executeMerge, {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 60_000,
    });
    console.log(JSON.stringify(result));
  }
} catch (error) {
  process.exitCode = 1;
  console.error(JSON.stringify({ status: "ERROR", error: error?.message ?? String(error), ...(error?.details === undefined ? {} : { details: error.details }) }));
} finally {
  if (prisma) await prisma.$disconnect();
}
