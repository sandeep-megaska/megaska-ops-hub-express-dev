import assert from "node:assert/strict";
import test from "node:test";

import { resolveCodAdvance, CodAdvanceResolverError, type CodAdvanceIntentLike, type CodAdvanceResolverDb } from "./resolver.ts";
import type { CodAdvancePolicyInput } from "./policy.ts";

const now = new Date("2026-07-13T00:00:00.000Z");

const basePolicyInput: CodAdvancePolicyInput = {
  enabled: true,
  advanceType: "FIXED",
  fixedAdvanceAmountPaise: 30000,
  percentageBasisPoints: null,
  minimumAdvanceAmountPaise: null,
  maximumAdvanceAmountPaise: null,
  minOrderAmountPaise: null,
  maxOrderAmountPaise: null,
  orderTotalPaise: 200000,
  storeCreditAppliedPaise: 0,
};

function createMockDb(initial: CodAdvanceIntentLike[] = []) {
  const intents = [...initial];
  const calls = { creates: 0, updates: 0, transactions: 0 };
  let lock = Promise.resolve();

  const db: CodAdvanceResolverDb & { intents: CodAdvanceIntentLike[]; calls: typeof calls } = {
    intents,
    calls,
    codAdvanceIntent: {
      async findMany(args: { where: { shopId: string; expressCheckoutIntentId: string } }) {
        const where = args.where;
        return intents
          .filter((intent) => intent.shopId === where.shopId && intent.expressCheckoutIntentId === where.expressCheckoutIntentId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
      async updateMany(args: { where: { id: { in: string[] }; status: { in: string[] }; paidAt: null; consumedAt: null; shopifyOrderId: null; shopifyOrderName: null }; data: { status: string } }) {
        calls.updates += 1;
        const ids = new Set(args.where.id.in);
        for (const intent of intents) {
          if (ids.has(intent.id) && args.where.status.in.includes(intent.status) && !intent.paidAt && !intent.consumedAt && !intent.shopifyOrderId && !intent.shopifyOrderName) {
            intent.status = args.data.status;
          }
        }
        return { count: ids.size };
      },
      async create(args: { data: Omit<CodAdvanceIntentLike, "id" | "status" | "createdAt"> & Partial<Pick<CodAdvanceIntentLike, "id" | "status" | "createdAt">> }) {
        calls.creates += 1;
        const intent: CodAdvanceIntentLike = {
          id: `intent-${calls.creates}`,
          status: "CREATED",
          createdAt: new Date(now.getTime() + calls.creates),
          paidAt: null,
          consumedAt: null,
          shopifyOrderId: null,
          shopifyOrderName: null,
          ...args.data,
        };
        intents.push(intent);
        return intent;
      },
    },
    async $transaction(fn) {
      calls.transactions += 1;
      const previous = lock;
      let release!: () => void;
      lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await fn(db);
      } finally {
        release();
      }
    },
  };

  return db;
}

function input(overrides: Partial<Parameters<typeof resolveCodAdvance>[0]> = {}) {
  return {
    db: createMockDb(),
    shopId: "shop-1",
    customerProfileId: "customer-1",
    expressCheckoutIntentId: "checkout-1",
    checkoutStatus: "PAYMENT_SELECTED",
    selectedPaymentMethod: "COD",
    policyInput: basePolicyInput,
    now,
    ...overrides,
  };
}

async function assertNoIntent(policyInput: Partial<CodAdvancePolicyInput>) {
  const db = createMockDb();
  const result = await resolveCodAdvance(input({ db, policyInput: { ...basePolicyInput, ...policyInput } }));
  assert.equal(result.codAdvanceIntentId, null);
  assert.equal(result.paymentMode, "COD");
  assert.equal(result.intent, null);
  assert.equal(db.calls.creates, 0);
  assert.equal(db.calls.transactions, 0);
}

test("disabled policy creates no CodAdvanceIntent", async () => {
  await assertNoIntent({ enabled: false });
});

test("below-minimum order creates no CodAdvanceIntent", async () => {
  await assertNoIntent({ minOrderAmountPaise: 250000 });
});

test("fixed advance zero creates no CodAdvanceIntent", async () => {
  await assertNoIntent({ fixedAdvanceAmountPaise: 0 });
});

test("full Store Credit creates no CodAdvanceIntent", async () => {
  await assertNoIntent({ storeCreditAppliedPaise: 200000 });
});

test("eligible advance still creates an intent", async () => {
  const db = createMockDb();
  const result = await resolveCodAdvance(input({ db }));
  assert.equal(result.paymentMode, "COD_ADVANCE");
  assert.equal(result.codAdvanceIntentId, "intent-1");
  assert.equal(db.calls.creates, 1);
  assert.equal(db.calls.transactions, 1);
});

for (const status of ["PAYMENT_PENDING", "ORDER_CREATING", "DRAFT_ORDER_CREATED"]) {
  test(`${status} checkout status is rejected`, async () => {
    await assert.rejects(() => resolveCodAdvance(input({ checkoutStatus: status })), (error) => {
      assert.ok(error instanceof CodAdvanceResolverError);
      assert.equal(error.status, 409);
      return true;
    });
  });
}

test("allowed PAYMENT_SELECTED state succeeds", async () => {
  const result = await resolveCodAdvance(input({ checkoutStatus: "PAYMENT_SELECTED" }));
  assert.equal(result.paymentMode, "COD_ADVANCE");
});

test("PREPAID selected payment method is rejected", async () => {
  await assert.rejects(() => resolveCodAdvance(input({ selectedPaymentMethod: "PREPAID" })), { status: 409 });
});

test("stale cancellation and replacement occur inside one transaction", async () => {
  const stale: CodAdvanceIntentLike = {
    id: "stale-1",
    shopId: "shop-1",
    customerProfileId: "customer-1",
    expressCheckoutIntentId: "checkout-1",
    orderAmountPaise: 200000,
    advanceAmountPaise: 30000,
    codBalanceAmountPaise: 170000,
    currency: "INR",
    status: "CREATED",
    expiresAt: new Date(now.getTime() - 1),
    paidAt: null,
    consumedAt: null,
    shopifyOrderId: null,
    shopifyOrderName: null,
    createdAt: new Date(now.getTime() - 1000),
  };
  const db = createMockDb([stale]);
  const result = await resolveCodAdvance(input({ db }));
  assert.equal(result.codAdvanceIntentId, "intent-1");
  assert.equal(stale.status, "EXPIRED");
  assert.equal(db.calls.updates, 1);
  assert.equal(db.calls.creates, 1);
  assert.equal(db.calls.transactions, 1);
});

test("two logical concurrent-resolution paths cannot both create through mocked transaction contract", async () => {
  const db = createMockDb();
  const [first, second] = await Promise.all([resolveCodAdvance(input({ db })), resolveCodAdvance(input({ db }))]);
  assert.equal(first.codAdvanceIntentId, "intent-1");
  assert.equal(second.codAdvanceIntentId, "intent-1");
  assert.equal(db.calls.creates, 1);
  assert.equal(db.calls.transactions, 2);
});

test("paid/order-linked intents are never cancelled", async () => {
  const protectedIntents: CodAdvanceIntentLike[] = [
    { id: "paid", paidAt: new Date(now), shopifyOrderId: null, status: "ADVANCE_PAID" },
    { id: "linked", paidAt: null, shopifyOrderId: "gid://shopify/Order/1", status: "ORDER_LINKED" },
  ].map((partial) => ({
    shopId: "shop-1",
    customerProfileId: "customer-1",
    expressCheckoutIntentId: "checkout-1",
    orderAmountPaise: 200000,
    advanceAmountPaise: 30000,
    codBalanceAmountPaise: 170000,
    currency: "INR",
    expiresAt: new Date(now.getTime() - 1),
    consumedAt: null,
    shopifyOrderName: null,
    createdAt: new Date(now.getTime() - 1000),
    ...partial,
  } as CodAdvanceIntentLike));
  const db = createMockDb(protectedIntents);
  await resolveCodAdvance(input({ db }));
  assert.equal(protectedIntents[0].status, "ADVANCE_PAID");
  assert.equal(protectedIntents[1].status, "ORDER_LINKED");
  assert.equal(db.calls.creates, 1);
});
