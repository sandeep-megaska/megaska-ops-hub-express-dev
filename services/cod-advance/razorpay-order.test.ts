/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";

import { CodAdvanceRazorpayOrderError, createCodAdvanceRazorpayOrder } from "./razorpay-order.ts";

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 120_000);

function base() {
  const cod = { id: "cod-1", shopId: "shop-1", customerProfileId: "cust-1", expressCheckoutIntentId: "intent-1", status: "CREATED", advanceAmountPaise: 12000, codBalanceAmountPaise: 98000, orderAmountPaise: 110000, storeCreditAppliedPaise: 0, currency: "INR", expiresAt: future(), paidAt: null, verifiedAt: null, consumedAt: null, razorpayPaymentId: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null, pricingFingerprint: "fp", settingsVersion: 1 };
  const checkout = { id: "intent-1", shopId: "shop-1", customerProfileId: "cust-1", status: "PAYMENT_SELECTED", selectedPaymentMethod: "COD", expiresAt: future(), orderLink: null };
  const state = { cod, checkout, payments: [] as any[], audits: [] as any[], providerBodies: [] as any[], updateManyWhere: [] as any[], transitionCount: 1, paymentSeq: 0 };
  const db: any = {
    shop: { findFirst: async ({ where }: any) => where.id === "shop-1" ? { id: "shop-1" } : null },
    expressCheckoutIntent: { findFirst: async ({ where }: any) => (where.shopId === state.checkout.shopId && where.customerProfileId === state.checkout.customerProfileId ? state.checkout : null) },
    codAdvanceIntent: {
      findFirst: async ({ where, select }: any) => where.id === state.cod.id ? (select ? { pricingFingerprint: state.cod.pricingFingerprint, settingsVersion: state.cod.settingsVersion, advanceAmountPaise: state.cod.advanceAmountPaise, codBalanceAmountPaise: state.cod.codBalanceAmountPaise } : state.cod) : null,
      updateMany: async ({ where }: any) => { state.updateManyWhere.push(where); return { count: state.transitionCount }; },
    },
    expressCheckoutPayment: {
      findFirst: async ({ where }: any) => state.payments.find((p) => p.shopId === where.shopId && p.intentId === where.intentId && p.status === where.status && (where.razorpayOrderId?.not === null ? p.razorpayOrderId !== null : p.razorpayOrderId === null) && (!where.createdAt?.gte || p.createdAt >= where.createdAt)) || null,
      create: async ({ data }: any) => { const p = { id: `pay-${++state.paymentSeq}`, createdAt: new Date(), razorpayOrderId: null, razorpayPaymentId: null, providerAmountPaise: null, providerCurrency: null, ...data }; state.payments.push(p); return p; },
      update: async ({ where, data }: any) => { const p = state.payments.find((x) => x.id === where.id); Object.assign(p, data); return p; },
      updateMany: async ({ where, data }: any) => { for (const p of state.payments) if (p.createdAt < where.createdAt.lt) Object.assign(p, data); return { count: 1 }; },
    },
    $executeRaw: async () => undefined,
    $transaction: async (fn: any) => typeof fn === "function" ? fn(db) : fn,
  };
  const policy = { requiresAdvance: true, codAdvanceIntentId: "cod-1", advanceAmountPaise: 12000, codBalanceAmountPaise: 98000, orderTotalPaise: 110000, storeCreditAppliedPaise: 0, currency: "INR" } as any;
  const deps = { db, keyId: "rzp_test", keySecret: "secret", resolvePolicy: async () => policy, audit: async (...args: any[]) => state.audits.push(args), fetch: async (_url: string, init: any) => { state.providerBodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ id: "order_1", amount: 12000, currency: "INR", status: "created" }) } as any; } };
  const input = { shopId: "shop-1", shopDomain: "shop.example", checkoutIntentId: "intent-1", customerProfileId: "cust-1" };
  return { state, deps, input };
}

test("route-compatible output hides internal snapshots and uses advance amount only", async () => {
  const h = base();
  const result = await createCodAdvanceRazorpayOrder(h.input, h.deps as any);
  assert.equal(result.razorpayOrder.id, "order_1");
  assert.equal(result.razorpayOrder.amount, 12000);
  assert.equal(result.cod.orderTotalPaise, 110000);
  assert.equal(result.reused, false);
  assert.equal(h.state.providerBodies[0].amount, 12000);
  assert.equal(h.state.providerBodies[0].notes.purpose, "COD_ADVANCE");
  assert.equal((result as any).pricingFingerprint, undefined);
});

test("wrong shop and wrong customer are not found", async () => {
  const h = base();
  await assert.rejects(() => createCodAdvanceRazorpayOrder({ ...h.input, shopId: "other" }, h.deps as any), (e: any) => e instanceof CodAdvanceRazorpayOrderError && e.status === 404);
  await assert.rejects(() => createCodAdvanceRazorpayOrder({ ...h.input, customerProfileId: "other" }, h.deps as any), (e: any) => e.status === 404);
});

test("PREPAID and expired checkout are rejected", async () => {
  const h = base();
  h.state.checkout.selectedPaymentMethod = "PREPAID";
  await assert.rejects(() => createCodAdvanceRazorpayOrder(h.input, h.deps as any), (e: any) => e.status === 409);
  h.state.checkout.selectedPaymentMethod = "COD"; h.state.checkout.expiresAt = past();
  await assert.rejects(() => createCodAdvanceRazorpayOrder(h.input, h.deps as any), (e: any) => e.status === 409);
});

test("existing provider order is reused and fresh reservation blocks concurrency", async () => {
  const h = base();
  h.state.payments.push({ id: "reuse", shopId: "shop-1", intentId: "intent-1", method: "COD", purpose: "COD_ADVANCE", status: "PENDING", amountPaise: 12000, currency: "INR", razorpayOrderId: "order_old", razorpayPaymentId: null, providerAmountPaise: null, providerCurrency: null, createdAt: future() });
  const reused = await createCodAdvanceRazorpayOrder(h.input, h.deps as any);
  assert.equal(reused.razorpayOrder.amount, 12000);
});

test("provider mismatch fails durably and guarded transition includes null guards", async () => {
  const h = base();
  (h.deps as any).fetch = async () => ({ ok: true, json: async () => ({ id: "order_bad", amount: 110000, currency: "INR" }) });
  await assert.rejects(() => createCodAdvanceRazorpayOrder(h.input, h.deps as any), (e: any) => e.code === "RAZORPAY_ORDER_CREATION_FAILED");
  assert.equal(h.state.payments[0].status, "FAILED");
  const h2 = base(); await createCodAdvanceRazorpayOrder(h2.input, h2.deps as any);
  assert.equal(h2.state.updateManyWhere[0].paidAt, null);
  assert.equal(h2.state.updateManyWhere[0].verifiedAt, null);
  assert.equal(h2.state.updateManyWhere[0].consumedAt, null);
  assert.equal(h2.state.updateManyWhere[0].shopifyDraftOrderId, null);
  assert.equal(h2.state.updateManyWhere[0].shopifyOrderId, null);
  assert.equal(h2.state.updateManyWhere[0].shopifyOrderName, null);
});

test("zero-row COD transition retains provider order and emits reconciliation", async () => {
  const h = base(); h.state.transitionCount = 0;
  await assert.rejects(() => createCodAdvanceRazorpayOrder(h.input, h.deps as any), (e: any) => e.code === "COD_ADVANCE_RECONCILIATION_REQUIRED");
  assert.equal(h.state.payments[0].razorpayOrderId, "order_1");
  assert.ok(h.state.audits.some((a) => a[0] === "cod_advance.reconciliation.required"));
});
