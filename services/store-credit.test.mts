import test from "node:test";
import assert from "node:assert/strict";

import { settleCodRefundAsStoreCredit } from "./store-credit";
import { prisma } from "./db/prisma";

const originalTransaction = prisma.$transaction;

test.afterEach(() => {
  prisma.$transaction = originalTransaction;
});

function makeRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: "refund-1",
    shopId: "shop-1",
    source: "ORDER_ACTION_REQUEST",
    sourceId: "issue-1",
    method: "COD",
    status: "APPROVED",
    currency: "INR",
    amount: 12500,
    customerProfileId: "cust-1",
    orderActionRequestId: "order-action-1",
    walletTransactionId: null,
    shopifyOrderId: "gid://shopify/Order/1",
    shopifyRefundId: null,
    reason: null,
    customerNote: null,
    adminNote: null,
    metadata: null,
    detailsSubmittedAt: null,
    approvedAt: null,
    rejectedAt: null,
    paidAt: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function mockTransaction(tx: Record<string, unknown>) {
  prisma.$transaction = (async (fn: (tx: Record<string, unknown>) => unknown) => fn(tx)) as typeof prisma.$transaction;
}

test("settles an eligible COD refund as Megaska Store Credit", async () => {
  const refund = makeRefund();
  const walletAccount = { id: "wallet-1", shopId: "shop-1", customerProfileId: "cust-1", currency: "INR", currentBalance: 0 };
  const walletTransaction = { id: "wallet-txn-1", walletAccountId: "wallet-1", amount: 12500, currency: "INR" };
  const eventCalls: unknown[] = [];

  mockTransaction({
    refundRequest: {
      findUnique: async () => refund,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...refund, ...data }),
    },
    walletTransaction: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => ({ ...walletTransaction, ...data }),
    },
    walletAccount: {
      upsert: async () => walletAccount,
      update: async ({ data }: { data: { currentBalance: { increment: number } } }) => ({
        ...walletAccount,
        currentBalance: walletAccount.currentBalance + data.currentBalance.increment,
      }),
    },
    refundEvent: { create: async (args: unknown) => eventCalls.push(args) },
  });

  const result = await settleCodRefundAsStoreCredit({ refundRequestId: "refund-1" });

  assert.equal(result.alreadySettled, false);
  assert.equal(result.refundRequest.status, "PAID");
  assert.equal(result.walletAccount.currentBalance, 12500);
  assert.equal(result.walletTransaction.sourceType, "REFUND_REQUEST");
  assert.equal(eventCalls.length, 1);
});

test("returns an already-settled refund without creating a duplicate credit", async () => {
  const refund = makeRefund({ status: "PAID", walletTransactionId: "wallet-txn-1" });
  let createCalls = 0;

  mockTransaction({
    refundRequest: { findUnique: async () => refund },
    walletTransaction: {
      findUnique: async () => ({
        id: "wallet-txn-1",
        walletAccountId: "wallet-1",
        walletAccount: { id: "wallet-1", currentBalance: 12500 },
      }),
      create: async () => {
        createCalls += 1;
        return null;
      },
    },
  });

  const result = await settleCodRefundAsStoreCredit({ refundRequestId: "refund-1" });

  assert.equal(result.alreadySettled, true);
  assert.equal(result.walletTransaction.id, "wallet-txn-1");
  assert.equal(createCalls, 0);
});

test("rejects non-COD refunds", async () => {
  mockTransaction({ refundRequest: { findUnique: async () => makeRefund({ method: "PREPAID" }) } });

  await assert.rejects(
    () => settleCodRefundAsStoreCredit({ refundRequestId: "refund-1" }),
    /Only COD refund requests can be settled as store credit/,
  );
});

test("rejects refunds without a customer profile", async () => {
  mockTransaction({ refundRequest: { findUnique: async () => makeRefund({ customerProfileId: null }) } });

  await assert.rejects(
    () => settleCodRefundAsStoreCredit({ refundRequestId: "refund-1" }),
    /customerProfileId is required/,
  );
});
