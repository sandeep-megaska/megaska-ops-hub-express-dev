/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";

import { CodAdvanceRazorpayOrderError, createCodAdvanceRazorpayOrder } from "./razorpay-order.ts";

const now = new Date("2026-07-13T00:00:00Z");

function makeHarness(overrides: { checkout?: any; cod?: any; transitionCount?: number; failPaymentUpdate?: boolean } = {}) {
  const state = { locks: [] as string[], payments: [] as any[], paymentUpdates: [] as any[], codUpdates: [] as any[], audits: [] as any[], gatewayCalls: 0, transactions: 0 };
  const checkout = { id: "checkout-1", shopId: "shop-1", status: "PAYMENT_SELECTED", ...overrides.checkout };
  const cod = { id: "cod-1", shopId: "shop-1", expressCheckoutIntentId: "checkout-1", status: "CREATED", advanceAmountPaise: 12000, currency: "INR", paidAt: null, verifiedAt: null, consumedAt: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null, ...overrides.cod };
  let queue = Promise.resolve();
  const db: any = {
    $executeRaw: (strings: TemplateStringsArray, key: string) => { state.locks.push(`${strings.join("?")}:${key}`); return Promise.resolve(); },
    expressCheckoutIntent: { findFirst: async () => checkout },
    codAdvanceIntent: {
      findFirst: async () => cod,
      updateMany: async (args: any) => { state.codUpdates.push(args); return { count: overrides.transitionCount ?? 1 }; },
    },
    expressCheckoutPayment: {
      findFirst: async () => state.payments.find((payment) => payment.razorpayOrderId) || null,
      create: async (args: any) => { const payment = { id: `pay-${state.payments.length + 1}`, createdAt: now, razorpayPaymentId: null, providerAmountPaise: null, providerCurrency: null, ...args.data }; state.payments.push(payment); return payment; },
      update: async (args: any) => {
        if (overrides.failPaymentUpdate) throw new Error("payment update failed");
        state.paymentUpdates.push(args);
        const payment = state.payments.find((row) => row.id === args.where.id);
        Object.assign(payment, args.data);
        return payment;
      },
    },
    $transaction: async (fn: any) => {
      state.transactions += 1;
      const run = queue.then(() => fn(db));
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return { db, state };
}

async function create(h: ReturnType<typeof makeHarness>, order: any = { id: "order-1", amount: 12000, currency: "INR" }) {
  return createCodAdvanceRazorpayOrder(
    { shopId: "shop-1", checkoutIntentId: "checkout-1", codAdvanceIntentId: "cod-1" },
    { db: h.db, keyId: "rzp_test", now: () => now, audit: async (...args) => { h.state.audits.push(args); }, createGatewayOrder: async () => { h.state.gatewayCalls += 1; return order; } },
  );
}

test("two concurrent calls create only one payment attempt and one provider order", async () => {
  const h = makeHarness();
  const results = await Promise.all([create(h), create(h)]);
  assert.equal(h.state.payments.length, 1);
  assert.equal(h.state.gatewayCalls, 1);
  assert.equal(results[0].razorpayOrderId, "order-1");
  assert.equal(results[1].razorpayOrderId, "order-1");
  assert.equal(results[1].idempotent, true);
});

test("advisory-lock/transaction path is used", async () => {
  const h = makeHarness();
  await create(h);
  assert.equal(h.state.transactions, 1);
  assert.equal(h.state.locks.length, 1);
  assert.match(h.state.locks[0], /pg_advisory_xact_lock\(hashtext/);
  assert.match(h.state.locks[0], /shop-1:checkout-1:cod_advance_razorpay_order/);
});

test("provider failure marks payment FAILED", async () => {
  const h = makeHarness();
  await assert.rejects(() => createCodAdvanceRazorpayOrder({ shopId: "shop-1", checkoutIntentId: "checkout-1", codAdvanceIntentId: "cod-1" }, { db: h.db, keyId: "rzp_test", now: () => now, audit: async (...args) => { h.state.audits.push(args); }, createGatewayOrder: async () => { throw new Error("provider down"); } }), (error: any) => error instanceof CodAdvanceRazorpayOrderError && error.code === "RAZORPAY_ORDER_CREATION_FAILED");
  assert.equal(h.state.paymentUpdates[0].data.status, "FAILED");
  assert.match(h.state.paymentUpdates[0].data.failureReason, /provider down/);
  assert.equal(h.state.codUpdates.length, 0);
  assert.equal(h.state.audits.some((audit) => audit[0] === "cod_advance.razorpay_order.failed"), true);
});

test("provider amount mismatch is rejected", async () => {
  const h = makeHarness();
  await assert.rejects(() => create(h, { id: "order-bad", amount: 11999, currency: "INR" }), (error: any) => error.code === "RAZORPAY_ORDER_CREATION_FAILED");
  assert.equal(h.state.paymentUpdates[0].data.status, "FAILED");
  assert.equal(h.state.codUpdates.length, 0);
});

test("provider currency mismatch is rejected", async () => {
  const h = makeHarness();
  await assert.rejects(() => create(h, { id: "order-bad", amount: 12000, currency: "USD" }), (error: any) => error.code === "RAZORPAY_ORDER_CREATION_FAILED");
  assert.equal(h.state.paymentUpdates[0].data.status, "FAILED");
  assert.equal(h.state.codUpdates.length, 0);
});

test("guarded CodAdvanceIntent transition includes all order-link null guards", async () => {
  const h = makeHarness();
  await create(h);
  assert.deepEqual(h.state.codUpdates[0].where, { id: "cod-1", shopId: "shop-1", status: { in: ["CREATED", "PAYMENT_PENDING"] }, paidAt: null, verifiedAt: null, consumedAt: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null });
});

test("zero-row transition emits reconciliation.required and returns failure", async () => {
  const h = makeHarness({ transitionCount: 0 });
  await assert.rejects(() => create(h), (error: any) => error instanceof CodAdvanceRazorpayOrderError && error.status === 503);
  assert.equal(h.state.audits.some((audit) => audit[0] === "cod_advance.reconciliation.required" && audit[3].razorpayOrderId === "order-1"), true);
});

test("PAYMENT_PENDING retry reuses the existing order", async () => {
  const h = makeHarness({ checkout: { status: "PAYMENT_PENDING" }, cod: { status: "PAYMENT_PENDING" } });
  h.state.payments.push({ id: "pay-existing", shopId: "shop-1", intentId: "checkout-1", purpose: "COD_ADVANCE", method: "COD", status: "PENDING", amountPaise: 12000, currency: "INR", razorpayOrderId: "order-existing", razorpayPaymentId: null, providerAmountPaise: null, providerCurrency: "inr", createdAt: now });
  const result = await create(h, { id: "should-not-call", amount: 12000, currency: "INR" });
  assert.equal(result.razorpayOrderId, "order-existing");
  assert.equal(result.idempotent, true);
  assert.equal(h.state.payments.length, 1);
  assert.equal(h.state.gatewayCalls, 0);
});

test("no Payment Link helper is used", async () => {
  const moduleText = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./razorpay-order.ts", import.meta.url), "utf8"));
  assert.equal(moduleText.includes("createCodAdvancePaymentLink"), false);
  assert.equal(moduleText.includes("payment_links"), false);
});
